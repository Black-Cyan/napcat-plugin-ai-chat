import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Jimp from 'jimp';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import type { ChatMessage, Conversation, MessageSegment, Sticker } from '../../types';
import type { ProviderContentPart } from '../../providers/types';
import { addCustomFace, getImage, sendMessage } from '../../napcat/actions';
import { imageSegment, stickerSegment } from '../../napcat/message-segments';
import { AITasks } from '../ai/tasks';
import { ALLOWED_MIME, detectMimeFromBuffer, downloadImage, type DownloadedImage } from './downloader';
import { effectiveStickers } from '../chat/config';

export class StickerService {
    constructor(private readonly store: Store, private readonly tasks: AITasks) {}

    async visionParts(messages: ChatMessage[], maxBytes: number): Promise<ProviderContentPart[]> {
        const parts: ProviderContentPart[] = [];
        for (const message of messages) {
            for (const segment of message.content) {
                if (!isImage(segment)) continue;
                try {
                    const image = await this.download(segment, maxBytes);
                    parts.push({ type: 'image', mime: image.mime, data: image.buffer.toString('base64') });
                } catch {
                    parts.push({ type: 'text', text: '[一张无法下载的图片]' });
                }
            }
        }
        return parts;
    }

    async processBatch(conversation: Conversation, messages: ChatMessage[]): Promise<void> {
        const config = effectiveStickers(conversation);
        if (!config.enabled || !config.autoCollect) return;
        for (const message of messages) {
            if (message.senderKind === 'self') continue;
            for (const segment of message.content) {
                if (!isImage(segment)) continue;
                try { await this.observe(conversation, message, segment, false); } catch { /* uncertain images are skipped */ }
            }
        }
    }

    async collect(conversation: Conversation, message: ChatMessage, segment: MessageSegment, force = false): Promise<Sticker> {
        const sticker = await this.observe(conversation, message, segment, force);
        if (!sticker) throw new Error('模型决定不收藏该表情');
        return sticker;
    }

    private async observe(conversation: Conversation, message: ChatMessage, segment: MessageSegment, force: boolean): Promise<Sticker | null> {
        const config = effectiveStickers(conversation);
        if (!config.enabled) throw new Error('表情包功能已停用');
        const image = await this.download(segment, config.maxImageBytes);
        const sha256 = createHash('sha256').update(image.buffer).digest('hex');
        const phash = await perceptualHash(image.buffer).catch(() => null);
        const napcatKey = segment.type === 'mface'
            ? `${String(segment.data.emoji_package_id ?? '')}:${String(segment.data.emoji_id ?? '')}`
            : null;
        const existing = await this.store.findSticker({ napcatKey, sha256, phash });
        await this.store.recordSighting({
            stickerId: existing?.id ?? null, conversationId: conversation.id,
            messageId: message.id, fingerprint: napcatKey || sha256,
        });
        if (existing) return existing;
        const understanding = await this.tasks.understandSticker({
            role: 'user',
            content: [
                { type: 'text', text: `请理解这张表情图片并给出是否值得收藏的判断。该表情此前在当前记录中出现 ${await this.store.countSightings(napcatKey || sha256)} 次，频率只是参考指标。` },
                { type: 'image', mime: image.mime, data: image.buffer.toString('base64') },
            ],
        }, conversation);
        if (!understanding.safe || understanding.confidence < 0.7 || (!force && !understanding.collect)) return null;
        const extension = extensionFor(image.mime);
        const directory = pluginState.getDataFilePath('media');
        const filename = path.join(directory, `${sha256}${extension}`);
        await ensureCacheCapacity(directory, config.cacheLimitMb, image.buffer.length);
        await fs.writeFile(filename, image.buffer, { mode: 0o600 });
        let sticker: Sticker;
        try {
            sticker = await this.store.saveSticker({
                napcatKey, sha256, phash, path: filename, mime: image.mime,
                summary: understanding.summary, tags: understanding.tags, safetyStatus: 'safe', enabled: true,
            });
        } catch (error) {
            await fs.unlink(filename).catch(() => undefined);
            throw error;
        }
        try {
            await addCustomFace(pluginState.ctx, filename, {
                emojiId: stringValue(segment.data.emoji_id),
                packageId: stringValue(segment.data.emoji_package_id),
                fileSize: image.buffer.length,
                md5: createHash('md5').update(image.buffer).digest('hex'),
                isMarketFace: segment.type === 'mface',
            });
        } catch {
            // The content-addressed local copy remains usable as an image segment.
        }
        return sticker;
    }

    async send(conversation: Conversation, id: string): Promise<string> {
        const config = effectiveStickers(conversation);
        if (!config.enabled || !config.autoSend) throw new Error('表情包发送已停用');
        const sticker = await this.store.getSticker(id);
        if (!sticker || !sticker.enabled || sticker.safetyStatus !== 'safe') throw new Error('表情包不可用');
        const mediaRoot = path.resolve(pluginState.getDataFilePath('media'));
        const resolved = path.resolve(sticker.path);
        if (!resolved.startsWith(`${mediaRoot}${path.sep}`)) throw new Error('表情包路径无效');
        const result = await sendMessage(pluginState.ctx, conversation, [stickerSegment(resolved)]);
        await this.store.markStickerUsed(id);
        return result.messageId;
    }

    async remove(id: string): Promise<void> {
        const sticker = await this.store.getSticker(id);
        if (!sticker) return;
        await this.store.deleteSticker(id);
        const root = path.resolve(pluginState.getDataFilePath('media'));
        const resolved = path.resolve(sticker.path);
        if (resolved.startsWith(`${root}${path.sep}`)) await fs.unlink(resolved).catch(() => undefined);
    }

    async readMedia(id: string): Promise<{ data: Buffer; mime: string }> {
        const sticker = await this.store.getSticker(id);
        if (!sticker) throw new Error('表情包不存在');
        const root = path.resolve(pluginState.getDataFilePath('media'));
        const resolved = path.resolve(sticker.path);
        if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('媒体路径无效');
        return { data: await fs.readFile(resolved), mime: sticker.mime };
    }

    private async download(segment: MessageSegment, maxBytes: number): Promise<DownloadedImage> {
        const candidates = [segment.data.url, segment.data.file, segment.data.src]
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);

        for (const candidate of candidates) {
            const b64 = tryParseBase64(candidate, maxBytes);
            if (b64) return b64;
            const local = await tryReadLocalImage(candidate, maxBytes);
            if (local) return local;
        }

        const httpSource = candidates.find((v) => /^https?:\/\//i.test(v.trim()));
        if (httpSource) {
            try {
                return await downloadImage(httpSource, maxBytes);
            } catch {
                // If direct HTTP download failed, fall back to NapCat action
            }
        }

        if (pluginState.hasContext) {
            const fileIdentifier = segment.data.file || segment.data.file_id || segment.data.url;
            if (typeof fileIdentifier === 'string' && fileIdentifier.trim()) {
                try {
                    const res = await getImage(pluginState.ctx, fileIdentifier.trim());
                    if (res) {
                        if (typeof res.base64 === 'string' && res.base64) {
                            const parsed = tryParseBase64(res.base64, maxBytes);
                            if (parsed) return parsed;
                        }
                        if (typeof res.url === 'string' && /^https?:\/\//i.test(res.url)) {
                            try {
                                return await downloadImage(res.url, maxBytes);
                            } catch { /* continue */ }
                        }
                        if (typeof res.file === 'string' && res.file) {
                            const b64 = tryParseBase64(res.file, maxBytes);
                            if (b64) return b64;
                            const local = await tryReadLocalImage(res.file, maxBytes);
                            if (local) return local;
                            if (/^https?:\/\//i.test(res.file)) {
                                return await downloadImage(res.file, maxBytes);
                            }
                        }
                    }
                } catch {
                    // get_image fallback failed
                }
            }
        }

        throw new Error('消息中没有可安全下载的图片 URL 或获取图片失败');
    }
}

async function tryReadLocalImage(candidate: string, maxBytes: number): Promise<DownloadedImage | null> {
    let filePath = candidate.trim();
    if (filePath.startsWith('file://')) {
        try {
            filePath = fileURLToPath(filePath);
        } catch {
            return null;
        }
    }
    if (!path.isAbsolute(filePath)) return null;
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > maxBytes) return null;
        const buffer = await fs.readFile(filePath);
        const mime = detectMimeFromBuffer(buffer);
        if (!mime || !ALLOWED_MIME.has(mime)) return null;
        return { buffer, mime, sourceUrl: `file://${filePath}` };
    } catch {
        return null;
    }
}

function tryParseBase64(candidate: string, maxBytes: number): DownloadedImage | null {
    let raw = candidate.trim();
    let explicitMime: string | null = null;
    const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/is);
    if (dataUrlMatch) {
        explicitMime = dataUrlMatch[1].toLocaleLowerCase();
        raw = dataUrlMatch[2].trim();
    } else if (raw.startsWith('base64://')) {
        raw = raw.slice('base64://'.length).trim();
    } else {
        return null;
    }
    try {
        const buffer = Buffer.from(raw, 'base64');
        if (buffer.length === 0 || buffer.length > maxBytes) return null;
        let mime = detectMimeFromBuffer(buffer) || explicitMime;
        if (mime === 'image/jpg') mime = 'image/jpeg';
        if (!mime || !ALLOWED_MIME.has(mime)) return null;
        return { buffer, mime, sourceUrl: 'data:image' };
    } catch {
        return null;
    }
}

function isImage(segment: MessageSegment): boolean {
    return segment.type === 'image' || segment.type === 'mface';
}

function stringValue(value: unknown): string | undefined {
    return value == null || value === '' ? undefined : String(value);
}

function extensionFor(mime: string): string {
    return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' } as Record<string, string>)[mime] ?? '.img';
}

async function perceptualHash(buffer: Buffer): Promise<string> {
    const image = await Jimp.read(buffer);
    image.resize(8, 8).greyscale();
    const data = image.bitmap.data;
    let total = 0;
    for (let index = 0; index < 64; index += 1) total += data[index * 4];
    const average = total / 64;
    let bits = '';
    for (let index = 0; index < 64; index += 1) bits += data[index * 4] >= average ? '1' : '0';
    return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

async function ensureCacheCapacity(directory: string, limitMb: number, incoming: number): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let size = incoming;
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const stat = await fs.stat(path.join(directory, entry.name));
        size += stat.size;
    }
    if (size > limitMb * 1024 * 1024) throw new Error('表情包缓存已达到上限');
}
