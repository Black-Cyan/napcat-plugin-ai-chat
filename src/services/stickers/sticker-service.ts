import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Jimp from 'jimp';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import type { ChatMessage, ComposedImages, Conversation, ImageAnnotation, MessageSegment, ProviderProfile, Sticker } from '../../types';
import type { ProviderContentPart, ProviderMessage } from '../../providers/types';
import { addCustomFace, getImage, sendMessage } from '../../napcat/actions';
import { imageSegment, stickerSegment } from '../../napcat/message-segments';
import { AITasks } from '../ai/tasks';
import { ALLOWED_MIME, detectMimeFromBuffer, downloadImage, type DownloadedImage } from './downloader';
import { effectiveStickers } from '../chat/config';
import { runtimeLogs } from '../../core/log-buffer';

interface PreparedImage {
    image: DownloadedImage;
    sha256: string;
    phash: string | null;
    napcatKey: string | null;
    fingerprint: string;
}

interface StickerUnderstanding {
    summary: string;
    tags: string[];
    safe: boolean;
    confidence: number;
    collect: boolean;
}

export class StickerService {
    constructor(private readonly store: Store, private readonly tasks: AITasks) {}

    async visionParts(messages: ChatMessage[], maxBytes: number): Promise<ComposedImages> {
        const parts: ProviderContentPart[] = [];
        const annotations: ImageAnnotation[] = [];
        for (const message of messages) {
            for (const [segmentIndex, segment] of message.content.entries()) {
                if (!isImage(segment)) continue;
                const ref = `img${annotations.length + 1}`;
                try {
                    const image = await this.download(segment, maxBytes);
                    const known = await this.knownSummary(image.buffer);
                    parts.push({ type: 'image', mime: image.mime, data: image.buffer.toString('base64') });
                    annotations.push({
                        messageId: message.id, segmentIndex, seq: message.seq, ref,
                        summary: known ?? String(segment.data.summary ?? '[图片]'), known: Boolean(known),
                    });
                } catch {
                    parts.push({ type: 'text', text: '[一张无法下载的图片]' });
                    annotations.push({ messageId: message.id, segmentIndex, seq: message.seq, ref, summary: '[图片下载失败]', known: false });
                }
            }
        }
        return { parts, annotations };
    }

    /**
     * 主聊天模型没有视觉能力时，改用配置的视觉任务模型把图片转述成文字。
     * 已收藏的表情直接复用收藏摘要，不再重复调用视觉模型。
     */
    async captionParts(messages: ChatMessage[], maxBytes: number, conversation: Conversation): Promise<ComposedImages> {
        const empty: ComposedImages = { parts: [], annotations: [] };
        const profile = this.tasks.visionProfile(conversation);
        if (!profile) return empty;
        const parts: ProviderContentPart[] = [];
        const annotations: ImageAnnotation[] = [];
        const pending: Array<{ index: number; message: ProviderMessage }> = [];
        for (const message of messages) {
            for (const [segmentIndex, segment] of message.content.entries()) {
                if (!isImage(segment)) continue;
                const ref = `img${annotations.length + 1}`;
                const annotation: ImageAnnotation = {
                    messageId: message.id, segmentIndex, seq: message.seq, ref, summary: '[图片]', known: false,
                };
                annotations.push(annotation);
                const slot = parts.length;
                parts.push({ type: 'text', text: '' });
                try {
                    const image = await this.download(segment, maxBytes);
                    const known = await this.knownSummary(image.buffer);
                    if (known) {
                        annotation.summary = known;
                        annotation.known = true;
                        parts[slot] = { type: 'text', text: `[已收藏表情：${known}]` };
                        continue;
                    }
                    pending.push({
                        index: slot,
                        message: { role: 'user', content: [{ type: 'image', mime: image.mime, data: image.buffer.toString('base64') }] },
                    });
                } catch {
                    annotation.summary = '[图片下载失败]';
                    parts[slot] = { type: 'text', text: '[一张无法下载的图片]' };
                }
            }
        }
        for (let start = 0; start < pending.length; start += 4) {
            const chunk = pending.slice(start, start + 4);
            try {
                const descriptions = await this.tasks.describeImages(chunk.map((item) => item.message), conversation, profile);
                for (const item of descriptions) {
                    const target = chunk[item.index];
                    if (!target) continue;
                    parts[target.index] = { type: 'text', text: `[图片内容：${item.description}]` };
                    const annotation = annotations[target.index];
                    if (annotation) annotation.summary = item.description;
                }
            } catch {
                // 转述失败的图片降级为占位符，不阻断回复。
            }
        }
        return {
            parts: parts.map((part) => part.type === 'text' && part.text === ''
                ? { type: 'text' as const, text: '[图片内容暂时无法转述]' }
                : part),
            annotations,
        };
    }

    private async knownSummary(buffer: Buffer): Promise<string | null> {
        try {
            const sha256 = createHash('sha256').update(buffer).digest('hex');
            const existing = await this.store.findSticker({ sha256 });
            return existing?.summary?.trim() || null;
        } catch {
            // 查询收藏库失败不应影响图片理解本身。
            return null;
        }
    }

    /**
     * 图片理解以配置为准：配置了独立的视觉任务模型就由它转述，主模型不再接收 base64 图片；
     * 视觉任务模型与主聊天模型是同一个配置（含继承主模型）时才直接内联，避免重复调用。
     */
    async imageParts(
        messages: ChatMessage[],
        maxBytes: number,
        conversation: Conversation,
        chatProfile: ProviderProfile,
    ): Promise<ComposedImages> {
        const vision = this.tasks.visionProfile(conversation);
        const inherited = !vision || (vision.id === chatProfile.id && vision.model === chatProfile.model);
        if (chatProfile.vision && inherited) return this.visionParts(messages, maxBytes);
        if (vision) {
            if (pluginState.config.debug) {
                runtimeLogs.add('debug', `图片理解使用视觉任务模型 [${vision.name}]（主模型 ${chatProfile.name}）`, 'model', {
                    visionProviderId: vision.id, visionModel: vision.model, chatProviderId: chatProfile.id, chatModel: chatProfile.model,
                });
            }
            return this.captionParts(messages, maxBytes, conversation);
        }
        return chatProfile.vision ? this.visionParts(messages, maxBytes) : { parts: [], annotations: [] };
    }

    async processBatch(conversation: Conversation, messages: ChatMessage[]): Promise<void> {
        const config = effectiveStickers(conversation);
        if (!config.enabled || !config.autoCollect) return;
        const pending: Array<{ prepared: PreparedImage; message: ChatMessage; segment: MessageSegment }> = [];
        for (const message of messages) {
            if (message.senderKind === 'self') continue;
            for (const segment of message.content) {
                if (!isImage(segment)) continue;
                try {
                    const prepared = await this.prepare(segment, config.maxImageBytes);
                    const existing = await this.store.findSticker({ napcatKey: prepared.napcatKey, sha256: prepared.sha256, phash: prepared.phash });
                    await this.store.recordSighting({
                        stickerId: existing?.id ?? null, conversationId: conversation.id,
                        messageId: message.id, fingerprint: prepared.fingerprint,
                    });
                    if (existing) continue;
                    if (await this.isCachedNegative(prepared.fingerprint, config.rejectionCooldownDays)) continue;
                    pending.push({ prepared, message, segment });
                } catch { /* 无法下载或解析的图片不参与收藏评估 */ }
            }
        }
        // 同一批次的新图合并评估，单次请求最多 4 张，避免每张图一次视觉调用。
        for (let start = 0; start < pending.length; start += 4) {
            const chunk = pending.slice(start, start + 4);
            try {
                const items = await Promise.all(chunk.map(async ({ prepared }) => ({
                    role: 'user' as const,
                    content: [
                        { type: 'text' as const, text: `该图片此前在当前记录中出现 ${await this.store.countSightings(prepared.fingerprint)} 次，频率只是参考指标。` },
                        { type: 'image' as const, mime: prepared.image.mime, data: prepared.image.buffer.toString('base64') },
                    ],
                })));
                const evaluations = await this.tasks.understandStickerBatch(items, conversation);
                for (let index = 0; index < chunk.length; index += 1) {
                    const evaluation = evaluations.find((item) => item.index === index);
                    if (!evaluation) continue;
                    const { prepared, segment } = chunk[index];
                    await this.finalize(conversation, segment, prepared, evaluation, config, false);
                }
            } catch { /* 本组评估失败时跳过，不影响后续批次 */ }
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
        const prepared = await this.prepare(segment, config.maxImageBytes);
        const existing = await this.store.findSticker({ napcatKey: prepared.napcatKey, sha256: prepared.sha256, phash: prepared.phash });
        await this.store.recordSighting({
            stickerId: existing?.id ?? null, conversationId: conversation.id,
            messageId: message.id, fingerprint: prepared.fingerprint,
        });
        if (existing) return existing;
        if (!force && await this.isCachedNegative(prepared.fingerprint, config.rejectionCooldownDays)) return null;
        const understanding = await this.tasks.understandSticker({
            role: 'user',
            content: [
                { type: 'text', text: `请理解这张表情图片并给出是否值得收藏的判断。该表情此前在当前记录中出现 ${await this.store.countSightings(prepared.fingerprint)} 次，频率只是参考指标。` },
                { type: 'image', mime: prepared.image.mime, data: prepared.image.buffer.toString('base64') },
            ],
        }, conversation);
        return this.finalize(conversation, segment, prepared, understanding, config, force);
    }

    private async prepare(segment: MessageSegment, maxBytes: number): Promise<PreparedImage> {
        const image = await this.download(segment, maxBytes);
        const sha256 = createHash('sha256').update(image.buffer).digest('hex');
        const phash = await perceptualHash(image.buffer).catch(() => null);
        const napcatKey = segment.type === 'mface'
            ? `${String(segment.data.emoji_package_id ?? '')}:${String(segment.data.emoji_id ?? '')}`
            : null;
        return { image, sha256, phash, napcatKey, fingerprint: napcatKey || sha256 };
    }

    private async isCachedNegative(fingerprint: string, cooldownDays: number): Promise<boolean> {
        const cached = await this.store.getStickerDecision(fingerprint);
        if (!cached || cached.decision === 'collect') return false;
        if (cached.decision === 'unsafe') return true;
        const cooldownMs = Math.max(0, cooldownDays) * 86400000;
        return cooldownMs > 0 && Date.now() - cached.evaluatedAt < cooldownMs;
    }

    private async finalize(
        conversation: Conversation,
        segment: MessageSegment,
        prepared: PreparedImage,
        understanding: StickerUnderstanding,
        config: ReturnType<typeof effectiveStickers>,
        force: boolean,
    ): Promise<Sticker | null> {
        const { image, sha256, phash, napcatKey, fingerprint } = prepared;
        if (!understanding.safe) {
            await this.store.recordStickerDecision(fingerprint, 'unsafe', understanding.summary);
            return null;
        }
        if (understanding.confidence < 0.7 || (!force && !understanding.collect)) {
            await this.store.recordStickerDecision(fingerprint, 'reject', understanding.summary);
            return null;
        }
        await this.store.recordStickerDecision(fingerprint, 'collect', understanding.summary);
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
