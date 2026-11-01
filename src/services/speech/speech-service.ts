import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import { runtimeLogs } from '../../core/log-buffer';
import type { ChatMessage, Conversation, MessageSegment, ProviderProfile, SynthesizedSpeech } from '../../types';
import { ProviderRegistry } from '../../providers/registry';
import { synthesizeSpeech, transcribeSpeech, type SpeechAudio } from '../../providers/speech';
import { canSendRecord, getRecord, sendMessage } from '../../napcat/actions';
import { recordSegment, textSegment } from '../../napcat/message-segments';
import { convertForQQ, convertToMp3, probeDurationSeconds } from './ffmpeg';
import { effectiveSpeech } from '../chat/config';

export class SpeechService {
    constructor(private readonly store: Store, private readonly providers: ProviderRegistry) {}

    private profileFor(kind: 'tts' | 'speech', conversation: Conversation): { profile: ProviderProfile; explicit: boolean } {
        const config = pluginState.config;
        const configured = config.taskProviders[kind];
        const id = configured
            ?? conversation.providerProfileId
            ?? conversation.override.providerProfileId
            ?? config.defaultProviderId;
        return { profile: this.providers.profile(id), explicit: Boolean(configured) };
    }

    ttsProfile(conversation: Conversation): ProviderProfile | null {
        try {
            const { profile, explicit } = this.profileFor('tts', conversation);
            // 显式指定的语音模型直接生效；继承主模型时才要求声明 TTS 能力。
            return explicit || profile.tts ? profile : null;
        } catch {
            return null;
        }
    }

    transcribeProfile(conversation: Conversation): ProviderProfile | null {
        try {
            const { profile, explicit } = this.profileFor('speech', conversation);
            return explicit || profile.speechRecognition ? profile : null;
        } catch {
            return null;
        }
    }

    async synthesize(conversation: Conversation, text: string): Promise<SynthesizedSpeech> {
        const config = effectiveSpeech(conversation);
        const content = text.trim();
        if (!content) throw new Error('语音文本不能为空');
        if (content.length > config.maxTtsTextLength) throw new Error(`语音文本超过 ${config.maxTtsTextLength} 字上限，请缩短后再试`);
        const profile = this.ttsProfile(conversation);
        if (!profile) throw new Error('尚未在任务模型中指定声明为 TTS 的语音合成模型');
        const key = createHash('sha256').update(JSON.stringify({
            provider: profile.id, model: profile.model, voice: profile.ttsVoice ?? '', speed: profile.ttsSpeed ?? 1, text: content,
        })).digest('hex');
        const directory = pluginState.getDataFilePath('speech');
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const existing = await this.findCached(directory, key);
        if (existing) {
            await fs.utimes(existing, new Date(), new Date()).catch(() => undefined);
            return { path: existing, mime: mimeForExtension(path.extname(existing)), cached: true };
        }
        const audio = await synthesizeSpeech(profile, content);
        const filename = path.join(directory, `${key}${audio.extension}`);
        await fs.writeFile(filename, audio.buffer, { mode: 0o600 });
        const duration = await probeDurationSeconds(filename);
        if (duration && duration > config.maxTtsSeconds) {
            await fs.unlink(filename).catch(() => undefined);
            throw new Error(`合成语音约 ${Math.round(duration)} 秒，超过 ${config.maxTtsSeconds} 秒上限，请缩短文本`);
        }
        await this.trimCache(directory, config.cacheLimitMb);
        return { path: filename, mime: audio.mime, cached: false };
    }

    /**
     * 发送语音：NapCat 直接转码 → 本机 ffmpeg 转 AMR → 回退文本。
     * 任何一级失败都不会让回复整体丢失。
     */
    async sendVoice(conversation: Conversation, text: string): Promise<{ messageId: string; fallback: boolean; cached?: boolean }> {
        const speech = await this.synthesize(conversation, text);
        const ctx = pluginState.ctx;
        if (await canSendRecord(ctx)) {
            try {
                const result = await sendMessage(ctx, conversation, [recordSegment(speech.path)]);
                return { messageId: result.messageId, fallback: false, cached: speech.cached };
            } catch (error) {
                runtimeLogs.add('debug', `语音直发失败，尝试本机转码：${String(error).slice(0, 200)}`, 'tool');
            }
            const converted = path.join(path.dirname(speech.path), `${path.basename(speech.path, path.extname(speech.path))}.amr`);
            if (await convertForQQ(speech.path, converted)) {
                try {
                    const result = await sendMessage(ctx, conversation, [recordSegment(converted)]);
                    return { messageId: result.messageId, fallback: false, cached: speech.cached };
                } catch (error) {
                    runtimeLogs.add('debug', `AMR 语音发送失败：${String(error).slice(0, 200)}`, 'tool');
                }
            }
        }
        const result = await sendMessage(ctx, conversation, [textSegment(text)]);
        return { messageId: result.messageId, fallback: true };
    }

    /** 把批次中的语音消息转写成文字附加段，数据库中的原始消息保持不变。 */
    async transcribeMessages(conversation: Conversation, messages: ChatMessage[]): Promise<ChatMessage[]> {
        const config = effectiveSpeech(conversation);
        if (!config.transcribe) return messages;
        if (!messages.some((message) => message.content.some((segment) => segment.type === 'record'))) return messages;
        const profile = this.transcribeProfile(conversation);
        if (!profile) {
            if (pluginState.config.debug) {
                runtimeLogs.add('debug', '收到语音但未转写：未指定语音转写模型，且继承的主模型未声明语音理解能力', 'model');
            }
            return messages;
        }
        if (pluginState.config.debug) {
            runtimeLogs.add('debug', `语音转写使用模型 [${profile.name}] (${profile.model})`, 'model');
        }
        const output: ChatMessage[] = [];
        for (const message of messages) {
            const additions: MessageSegment[] = [];
            for (const segment of message.content) {
                if (segment.type !== 'record') continue;
                try {
                    additions.push(textSegment(`[语音转写：${await this.transcribeSegment(conversation, segment, profile, config.maxRecordBytes, config.maxTranscribeSeconds)}]`));
                } catch (error) {
                    additions.push(textSegment(`[语音转写失败：${error instanceof Error ? error.message.slice(0, 120) : '未知原因'}]`));
                }
            }
            output.push(additions.length ? { ...message, content: [...message.content, ...additions] } : message);
        }
        return output;
    }

    private async transcribeSegment(
        conversation: Conversation,
        segment: MessageSegment,
        profile: ProviderProfile,
        maxBytes: number,
        maxSeconds: number,
    ): Promise<string> {
        let audio = await this.resolveRecordAudio(segment, maxBytes);
        const sha256 = createHash('sha256').update(audio.buffer).digest('hex');
        const cached = await this.store.getSpeechTranscript(conversation.id, sha256);
        if (cached) return cached;
        const temporary = path.join(pluginState.getDataFilePath('speech'), `incoming-${randomUUID()}${audio.extension}`);
        await fs.mkdir(path.dirname(temporary), { recursive: true, mode: 0o700 });
        await fs.writeFile(temporary, audio.buffer, { mode: 0o600 });
        let input = temporary;
        try {
            if (audio.extension === '.amr' || audio.extension === '.silk' || /amr|silk/i.test(audio.mime)) {
                const converted = temporary.replace(/\.[^.]+$/, '.mp3');
                if (await convertToMp3(temporary, converted)) {
                    input = converted;
                    audio = { ...audio, buffer: await fs.readFile(converted), mime: 'audio/mpeg', extension: '.mp3' };
                }
            }
            const duration = await probeDurationSeconds(input);
            if (duration && duration > maxSeconds) return `语音约 ${Math.round(duration)} 秒，超过 ${maxSeconds} 秒上限，未转写`;
            const transcript = await transcribeSpeech(profile, audio);
            await this.store.saveSpeechTranscript(conversation.id, sha256, transcript);
            return transcript;
        } finally {
            await fs.unlink(temporary).catch(() => undefined);
            if (input !== temporary) await fs.unlink(input).catch(() => undefined);
        }
    }

    private async resolveRecordAudio(segment: MessageSegment, maxBytes: number): Promise<SpeechAudio> {
        const candidates: string[] = [];
        if (pluginState.hasContext) {
            try {
                const result = await getRecord(pluginState.ctx, {
                    file: stringValue(segment.data.file),
                    fileId: stringValue(segment.data.file_id),
                    outFormat: 'mp3',
                });
                candidates.push(...[result.base64, result.file, result.url].filter((value): value is string => Boolean(value)));
            } catch {
                // 继续使用消息段自带的地址。
            }
        }
        candidates.push(...[segment.data.url, segment.data.file].filter((value): value is string => typeof value === 'string' && value.length > 0));
        for (const candidate of candidates) {
            const audio = await readAudioCandidate(candidate, maxBytes);
            if (audio) return audio;
        }
        throw new Error('无法获取语音文件');
    }

    private async findCached(directory: string, key: string): Promise<string | null> {
        for (const extension of ['.mp3', '.wav', '.ogg', '.amr']) {
            const candidate = path.join(directory, `${key}${extension}`);
            try {
                const stat = await fs.stat(candidate);
                if (stat.isFile()) return candidate;
            } catch { /* 未命中缓存 */ }
        }
        return null;
    }

    private async trimCache(directory: string, limitMb: number): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const files: Array<{ path: string; size: number; mtime: number }> = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.name.startsWith('incoming-')) continue;
            const file = path.join(directory, entry.name);
            const stat = await fs.stat(file);
            files.push({ path: file, size: stat.size, mtime: stat.mtimeMs });
        }
        let total = files.reduce((sum, file) => sum + file.size, 0);
        const limit = limitMb * 1024 * 1024;
        for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
            if (total <= limit) break;
            await fs.unlink(file.path).catch(() => undefined);
            total -= file.size;
        }
    }
}

async function readAudioCandidate(candidate: string, maxBytes: number): Promise<SpeechAudio | null> {
    const value = candidate.trim();
    if (!value) return null;
    const dataUrl = value.match(/^data:(audio\/[a-zA-Z0-9.+_-]+);base64,(.+)$/is);
    const mime = dataUrl?.[1] ?? 'audio/mpeg';
    const encoded = dataUrl?.[2] ?? (value.startsWith('base64://') ? value.slice('base64://'.length) : null);
    if (encoded) {
        const buffer = Buffer.from(encoded.trim(), 'base64');
        if (!buffer.length || buffer.length > maxBytes) return null;
        return { buffer, mime, extension: extensionForMime(mime) };
    }
    if (value.startsWith('file://') || path.isAbsolute(value)) {
        const filename = value.startsWith('file://') ? value.slice('file://'.length) : value;
        try {
            const stat = await fs.stat(filename);
            if (!stat.isFile() || stat.size > maxBytes) return null;
            const buffer = await fs.readFile(filename);
            return { buffer, mime: mimeForExtension(path.extname(filename)), extension: path.extname(filename) || '.mp3' };
        } catch {
            return null;
        }
    }
    if (/^https?:\/\//i.test(value)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(value.replace(/&amp;/g, '&'), { signal: controller.signal });
            if (!response.ok) return null;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length || buffer.length > maxBytes) return null;
            const mime = response.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
            return { buffer, mime, extension: extensionForMime(mime) };
        } catch {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }
    return null;
}

function stringValue(value: unknown): string | undefined {
    return value == null || value === '' ? undefined : String(value);
}

function mimeForExtension(extension: string): string {
    return ({
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.amr': 'audio/amr', '.silk': 'audio/silk',
    } as Record<string, string>)[extension.toLocaleLowerCase()] ?? 'audio/mpeg';
}

function extensionForMime(mime: string): string {
    if (/wav/i.test(mime)) return '.wav';
    if (/ogg|opus/i.test(mime)) return '.ogg';
    if (/amr/i.test(mime)) return '.amr';
    return '.mp3';
}
