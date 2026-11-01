import type { ProviderProfile } from '../types';
import { ProviderError } from './types';
import { googleApiRoot, googleModelResource } from './google/http';

export interface SpeechAudio {
    buffer: Buffer;
    mime: string;
    extension: string;
}

const OPENAI_ROOT = 'https://api.openai.com/v1';
const FISH_ROOT = 'https://api.fish.audio';
const TRANSCRIBE_PROMPT = '请把这段语音完整转写为文字，只输出转写内容本身，不要解释、翻译或评价；听不清的部分用"…"表示。';

function openAiRoot(profile: ProviderProfile): string {
    return (profile.baseUrl?.trim() || OPENAI_ROOT).replace(/\/+$/, '');
}

function speechError(action: string, status: number, body: string, url = ''): ProviderError {
    const detail = body.replace(/\s+/g, ' ').trim().slice(0, 300) || '响应为空';
    let endpoint = '';
    if (url) {
        try { endpoint = ` ${new URL(url).pathname}`; } catch { endpoint = ''; }
    }
    return new ProviderError(`${action}失败（HTTP ${status}${endpoint}）：${detail}`, status, false, status === 429 || status >= 500);
}

async function postSpeech(profile: ProviderProfile, url: string, init: RequestInit, action: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) throw speechError(action, response.status, await response.text(), url);
        return response;
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(`${action}网络请求失败`, 0, false, true);
    } finally {
        clearTimeout(timeout);
    }
}

function fishRoot(profile: ProviderProfile): string {
    return (profile.baseUrl?.trim() || FISH_ROOT).replace(/\/+$/, '');
}

async function synthesizeFishAudio(profile: ProviderProfile, text: string, emphasis = false): Promise<SpeechAudio> {
    const response = await postSpeech(profile, `${fishRoot(profile)}/v1/tts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${profile.apiKey}`,
            model: profile.model || 's2.1-pro',
        },
        body: JSON.stringify({
            text,
            ...(profile.ttsVoice?.trim() ? { reference_id: profile.ttsVoice.trim() } : {}),
            format: 'mp3',
            prosody: {
                speed: Math.min(2, Math.max(0.5, (profile.ttsSpeed ?? 1) * (emphasis ? 0.95 : 1))),
                volume: emphasis ? 2 : 0,
                normalize_loudness: true,
            },
            normalize: true,
        }),
    }, '语音合成');
    return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg', extension: '.mp3' };
}

function fishTranscribeModel(profile: ProviderProfile): string {
    if (profile.model?.trim().startsWith('transcribe')) return profile.model.trim();
    return profile.sttModel?.trim() || 'transcribe-1-pro';
}

async function transcribeFishAudio(profile: ProviderProfile, audio: SpeechAudio): Promise<string> {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio.buffer)], { type: audio.mime }), `voice${audio.extension}`);
    form.append('ignore_timestamps', 'true');
    const response = await postSpeech(profile, `${fishRoot(profile)}/v1/asr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${profile.apiKey}`, model: fishTranscribeModel(profile) },
        body: form,
    }, '语音转写');
    const payload = await response.json() as { text?: string };
    const text = payload.text?.trim();
    if (!text) throw new ProviderError('语音转写未返回文本', 502, false, false);
    return text;
}

export async function synthesizeSpeech(profile: ProviderProfile, text: string, options: { emphasis?: boolean } = {}): Promise<SpeechAudio> {
    if (profile.type === 'fishaudio') return synthesizeFishAudio(profile, text, options.emphasis === true);
    if (profile.type === 'openai') {
        const response = await postSpeech(profile, `${openAiRoot(profile)}/audio/speech`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
            body: JSON.stringify({
                model: profile.model,
                input: text,
                voice: profile.ttsVoice?.trim() || 'alloy',
                speed: profile.ttsSpeed ?? 1,
                response_format: 'mp3',
            }),
        }, '语音合成');
        return { buffer: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg', extension: '.mp3' };
    }
    if (profile.type === 'google') {
        const url = `${googleApiRoot(profile.baseUrl)}/${googleModelResource(profile.model)}:generateContent`;
        const response = await postSpeech(profile, url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.ttsVoice?.trim() || 'Kore' } } },
                },
            }),
        }, '语音合成');
        const payload = await response.json() as any;
        const parts: any[] = payload.candidates?.[0]?.content?.parts ?? [];
        const inline = parts.find((part) => part.inlineData?.data)?.inlineData;
        if (!inline) throw new ProviderError('该模型未返回音频，可能不是 TTS 语音合成模型，请检查模型名是否为 Gemini TTS 系列', 400, false, false);
        const buffer = Buffer.from(String(inline.data), 'base64');
        const mime = String(inline.mimeType ?? 'audio/L16');
        if (/l16|pcm/i.test(mime)) {
            const rate = Number(/rate=(\d+)/i.exec(mime)?.[1] ?? 24000);
            return { buffer: pcmToWav(buffer, rate), mime: 'audio/wav', extension: '.wav' };
        }
        if (/wav/i.test(mime)) return { buffer, mime: 'audio/wav', extension: '.wav' };
        if (/mpeg|mp3/i.test(mime)) return { buffer, mime: 'audio/mpeg', extension: '.mp3' };
        if (/ogg|opus/i.test(mime)) return { buffer, mime: 'audio/ogg', extension: '.ogg' };
        return { buffer, mime: 'audio/wav', extension: '.wav' };
    }
    throw new ProviderError('该模型供应商不支持语音合成', 400, false, false);
}

export async function transcribeSpeech(profile: ProviderProfile, audio: SpeechAudio): Promise<string> {
    if (profile.type === 'fishaudio') return transcribeFishAudio(profile, audio);
    if (profile.type === 'openai') {
        try {
            return await transcribeViaWhisperEndpoint(profile, audio);
        } catch (error) {
            // 许多 OpenAI 兼容供应商（如豆包）没有 /audio/transcriptions，但能在聊天补全里接收音频。
            if (!(error instanceof ProviderError) || ![400, 404, 415, 422, 501].includes(error.status)) throw error;
            try {
                return await transcribeViaChatCompletion(profile, audio);
            } catch (fallback) {
                const detail = fallback instanceof Error ? fallback.message : String(fallback);
                throw new ProviderError(`${error.message}；聊天补全音频转写也不可用：${detail}`, 0, false, false);
            }
        }
    }
    if (profile.type === 'google') return transcribeViaGoogle(profile, audio);
    throw new ProviderError('该模型供应商不支持语音转写', 400, false, false);
}

async function transcribeViaWhisperEndpoint(profile: ProviderProfile, audio: SpeechAudio): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio.buffer)], { type: audio.mime }), `voice${audio.extension}`);
    form.append('model', profile.model);
    form.append('response_format', 'json');
    const response = await postSpeech(profile, `${openAiRoot(profile)}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${profile.apiKey}` },
        body: form,
    }, '语音转写');
    const payload = await response.json() as { text?: string };
    const text = payload.text?.trim();
    if (!text) throw new ProviderError('语音转写未返回文本', 502, false, false);
    return text;
}

async function transcribeViaChatCompletion(profile: ProviderProfile, audio: SpeechAudio): Promise<string> {
    const response = await postSpeech(profile, `${openAiRoot(profile)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
        body: JSON.stringify({
            model: profile.model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: TRANSCRIBE_PROMPT },
                    { type: 'input_audio', input_audio: { data: audio.buffer.toString('base64'), format: audio.extension === '.wav' ? 'wav' : 'mp3' } },
                ],
            }],
        }),
    }, '语音转写');
    const payload = await response.json() as any;
    const content = payload.choices?.[0]?.message?.content;
    const text = typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
            ? content.filter((part: any) => part?.type === 'text').map((part: any) => String(part.text ?? '')).join('').trim()
            : '';
    if (!text) throw new ProviderError('聊天补全未返回转写文本', 502, false, false);
    return text;
}

async function transcribeViaGoogle(profile: ProviderProfile, audio: SpeechAudio): Promise<string> {
    const url = `${googleApiRoot(profile.baseUrl)}/${googleModelResource(profile.model)}:generateContent`;
    const response = await postSpeech(profile, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { text: TRANSCRIBE_PROMPT },
                    { inlineData: { mimeType: audio.mime, data: audio.buffer.toString('base64') } },
                ],
            }],
        }),
    }, '语音转写');
    const payload = await response.json() as any;
    const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .filter((part: any) => typeof part.text === 'string' && !part.thought)
        .map((part: any) => part.text).join('').trim();
    if (!text) throw new ProviderError('语音转写未返回文本', 502, false, false);
    return text;
}

/** Google TTS 返回的是裸 PCM，封装成 WAV 后 NapCat / ffmpeg 才能继续转码。 */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}
