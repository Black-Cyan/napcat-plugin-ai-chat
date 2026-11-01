import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpeechService } from '../services/speech/speech-service';
import { pcmToWav, synthesizeSpeech, transcribeSpeech } from '../providers/speech';
import { ProviderRegistry } from '../providers/registry';
import { pluginState } from '../core/state';
import { createDefaultConfig } from '../config';
import { flattenMarkup, hasFineControl, parseFishMarkup } from '../providers/fish-markup';
import { concatAudio, createSilence } from '../services/speech/ffmpeg';
import { ToolBroker } from '../services/chat/tool-broker';
import type { Store } from '../database/store';
import type { ChatMessage, Conversation, ProviderProfile } from '../types';

vi.mock('../services/speech/ffmpeg', () => ({
    probeDurationSeconds: vi.fn().mockResolvedValue(null),
    convertForQQ: vi.fn().mockResolvedValue(false),
    convertToMp3: vi.fn().mockResolvedValue(false),
    createSilence: vi.fn().mockResolvedValue(true),
    concatAudio: vi.fn().mockResolvedValue(true),
}));

const conversation: Conversation = {
    id: 'c1', type: 'private', targetId: '10001', title: 'test', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};
const profile = (patch: Partial<ProviderProfile> = {}): ProviderProfile => ({
    id: 'p1', name: 'Speech', type: 'openai', model: 'tts-1', apiKey: 'secret',
    contextWindow: 1000, maxOutputTokens: 100, temperature: 0.7,
    vision: false, toolCalling: true, structuredOutput: true, tts: true, speechRecognition: true, ...patch,
});
const voiceMessage = (file: string): ChatMessage => ({
    id: 'm1', conversationId: 'c1', seq: 1, batchId: 'b1', napcatMessageId: 'n1',
    senderId: '10001', senderName: 'Alice', senderKind: 'human', role: 'user',
    content: [{ type: 'record', data: { file } }], rawEvent: {}, occurredAt: 1, receivedAt: 1,
});

let directory = '';
let audioFile = '';
let store: { getSpeechTranscript: ReturnType<typeof vi.fn>; saveSpeechTranscript: ReturnType<typeof vi.fn> };
let actionCall: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-test-'));
    audioFile = path.join(directory, 'incoming.mp3');
    await fs.writeFile(audioFile, Buffer.from('ID3-fake-audio'));
    actionCall = vi.fn().mockImplementation((name: string) => {
        if (name === 'get_record') return Promise.resolve({ file: audioFile });
        if (name === 'can_send_record') return Promise.resolve({ can_send: true });
        return Promise.resolve({ message_id: '1' });
    });
    pluginState.setContextForTest({
        dataPath: directory, configPath: path.join(directory, 'config.json'),
        adapterName: 'test', pluginManager: { config: {} },
        actions: { call: actionCall },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    } as never);
    pluginState.config = createDefaultConfig();
    store = {
        getSpeechTranscript: vi.fn().mockResolvedValue(null),
        saveSpeechTranscript: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(async () => {
    vi.unstubAllGlobals();
    pluginState.setContextForTest(null);
    await fs.rm(directory, { recursive: true, force: true });
});

const service = (profiles: ProviderProfile[]) => new SpeechService(
    store as unknown as Store,
    new ProviderRegistry(() => profiles),
);

describe('speech synthesis', () => {
    it('requests the OpenAI audio speech endpoint and caches repeated text', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('mp3-bytes'), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const speech = service([profile()]);
        const first = await speech.synthesize(conversation, '你好呀');
        const second = await speech.synthesize(conversation, '你好呀');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.openai.com/v1/audio/speech');
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ model: 'tts-1', input: '你好呀', voice: 'alloy', response_format: 'mp3' });
        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
        expect(second.path).toBe(first.path);
    });

    it('rejects text beyond the configured limit before calling the model', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        pluginState.config.speech.maxTtsTextLength = 5;
        await expect(service([profile()]).synthesize(conversation, '这段文字明显超长')).rejects.toThrow('上限');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects chat models that are not speech-capable', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(service([profile({ model: 'gpt-4o-mini', tts: false })]).synthesize(conversation, '你好')).rejects.toThrow('TTS');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('wraps Google PCM output into a WAV container', async () => {
        const pcm = Buffer.alloc(24000 * 2, 1);
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const audio = await synthesizeSpeech(profile({ type: 'google', model: 'gemini-tts' }), '你好');
        expect(audio.mime).toBe('audio/wav');
        expect(audio.buffer.subarray(0, 4).toString()).toBe('RIFF');
        expect(audio.buffer.readUInt32LE(24)).toBe(24000);
        expect(audio.buffer.length).toBe(44 + pcm.length);
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(String(init.body)).generationConfig.responseModalities).toEqual(['AUDIO']);
    });

    it('writes a valid WAV header for 16-bit mono PCM', () => {
        const wav = pcmToWav(Buffer.alloc(2000), 16000);
        expect(wav.readUInt32LE(4)).toBe(2036);
        expect(wav.readUInt32LE(28)).toBe(32000);
        expect(wav.subarray(36, 40).toString()).toBe('data');
    });
});

describe('speech transcription', () => {
    it('transcribes record segments and caches per conversation', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '今晚一起吃饭' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        store.getSpeechTranscript.mockResolvedValueOnce(null).mockResolvedValue('今晚一起吃饭');
        const speech = service([profile({ model: 'whisper-1' })]);
        const messages = await speech.transcribeMessages(conversation, [voiceMessage('voice-file')]);
        const again = await speech.transcribeMessages(conversation, [voiceMessage('voice-file')]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions');
        expect(init.body).toBeInstanceOf(FormData);
        expect(messages[0].content.at(-1)?.data.text).toBe('[语音转写：今晚一起吃饭]');
        expect(again[0].content.at(-1)?.data.text).toBe('[语音转写：今晚一起吃饭]');
        expect(store.saveSpeechTranscript).toHaveBeenCalledWith('c1', expect.any(String), '今晚一起吃饭');
    });

    it('skips transcription when disabled or when the model is not declared for speech', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        pluginState.config.speech.transcribe = false;
        const disabled = await service([profile()]).transcribeMessages(conversation, [voiceMessage('voice-file')]);
        expect(disabled[0].content).toHaveLength(1);

        pluginState.config.speech.transcribe = true;
        const undeclared = await service([profile({ speechRecognition: false })]).transcribeMessages(conversation, [voiceMessage('voice-file')]);
        expect(undeclared[0].content).toHaveLength(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to chat completions with input_audio when the transcriptions endpoint is missing', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (String(url).includes('/audio/transcriptions')) return Promise.resolve(new Response('', { status: 404 }));
            return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '转写成功' } }] }), { status: 200 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const text = await transcribeSpeech(profile({ model: 'doubao-seed-2.0-mini' }), {
            buffer: Buffer.from('audio'), mime: 'audio/mpeg', extension: '.mp3',
        });
        expect(text).toBe('转写成功');
        const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/chat/completions'))!;
        const body = JSON.parse(String(chatCall[1].body));
        expect(body.model).toBe('doubao-seed-2.0-mini');
        expect(body.messages[0].content[1].input_audio.format).toBe('mp3');
    });

    it('names the failing endpoint and both attempts when transcription is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 404 }))));
        const error = await transcribeSpeech(profile(), { buffer: Buffer.from('a'), mime: 'audio/mpeg', extension: '.mp3' })
            .catch((reason) => reason);
        expect(error.message).toContain('/audio/transcriptions');
        expect(error.message).toContain('/chat/completions');
        expect(error.message).toContain('响应为空');
    });

    it('sends Google audio inline for transcription', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: '转写结果' }] } }],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const text = await transcribeSpeech(profile({ type: 'google', model: 'gemini-audio' }), {
            buffer: Buffer.from('audio'), mime: 'audio/mpeg', extension: '.mp3',
        });
        expect(text).toBe('转写结果');
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/mpeg');
    });
});

describe('voice sending fallbacks', () => {
    it('falls back to text when NapCat cannot send the record and no encoder is available', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('mp3'), { status: 200 })));
        actionCall.mockImplementation((name: string, params: { message?: Array<{ type: string }> }) => {
            if (name === 'can_send_record') return Promise.resolve({ can_send: true });
            if (name === 'send_msg' && params.message?.[0]?.type === 'record') return Promise.reject(new Error('编码不支持'));
            return Promise.resolve({ message_id: '42' });
        });
        const result = await service([profile()]).sendVoice(conversation, '晚安');
        expect(result).toEqual({ messageId: '42', fallback: true });
        const textCall = actionCall.mock.calls.find(([name, params]) => name === 'send_msg' && params.message?.[0]?.type === 'text');
        expect(textCall?.[1].message[0].data.text).toBe('晚安');
    });

    it('sends the record segment directly when NapCat accepts it', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('mp3'), { status: 200 })));
        const result = await service([profile()]).sendVoice(conversation, '晚安');
        expect(result.fallback).toBe(false);
        const recordCall = actionCall.mock.calls.find(([name, params]) => name === 'send_msg' && params.message?.[0]?.type === 'record');
        expect(recordCall?.[1].message[0].data.file).toContain('.mp3');
    });
});

describe('explicit speech task assignment', () => {
    it('uses the explicitly assigned TTS model even without a capability declaration', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(Buffer.from('mp3'), { status: 200 })));
        pluginState.config.taskProviders.tts = 'p1';
        const result = await service([profile({ tts: false })]).synthesize(conversation, '你好');
        expect(result.path).toContain('.mp3');
    });

    it('transcribes with an explicitly assigned model even without a declaration', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '语音内容' }), { status: 200 })));
        pluginState.config.taskProviders.speech = 'p1';
        const messages = await service([profile({ speechRecognition: false, model: 'whisper-1' })])
            .transcribeMessages(conversation, [voiceMessage('voice-file')]);
        expect(messages[0].content.at(-1)?.data.text).toBe('[语音转写：语音内容]');
    });
});

describe('send_voice tool availability', () => {
    const broker = (ttsAvailable: boolean) => new ToolBroker(
        {} as never,
        {} as never,
        { ttsProfile: vi.fn().mockReturnValue(ttsAvailable ? profile() : null) } as never,
    );

    it('appears automatically once a TTS model is configured', () => {
        const names = broker(true).definitions(true, conversation).map((tool) => tool.name);
        expect(names).toContain('send_voice');
    });

    it('stays hidden without a TTS model', () => {
        const names = broker(false).definitions(true, conversation).map((tool) => tool.name);
        expect(names).not.toContain('send_voice');
    });

    it('can still be disabled per conversation', () => {
        const disabled: Conversation = { ...conversation, override: { speech: { sendVoice: false } } };
        const names = broker(true).definitions(true, disabled).map((tool) => tool.name);
        expect(names).not.toContain('send_voice');
    });
});

describe('Fish Audio protocol', () => {
    it('sends TTS requests with the model header and prosody settings', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('mp3'), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const audio = await synthesizeSpeech(profile({
            type: 'fishaudio', model: 's2.1-pro-free', ttsVoice: 'voice-model-id', ttsSpeed: 1.2,
        }), '你好');
        expect(audio.mime).toBe('audio/mpeg');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.fish.audio/v1/tts');
        expect(init.headers.model).toBe('s2.1-pro-free');
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ text: '你好', reference_id: 'voice-model-id', format: 'mp3' });
        expect(body.prosody.speed).toBe(1.2);
    });

    it('sends ASR requests as multipart with the transcribe model header', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '转写内容' }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const text = await transcribeSpeech(profile({ type: 'fishaudio', model: 'transcribe-1-pro' }), {
            buffer: Buffer.from('audio'), mime: 'audio/mpeg', extension: '.mp3',
        });
        expect(text).toBe('转写内容');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://api.fish.audio/v1/asr');
        expect(init.headers.model).toBe('transcribe-1-pro');
        expect(init.body).toBeInstanceOf(FormData);
    });
});

describe('Fish fine-grained markup', () => {
    it('parses pauses and emphasis without leaving markers in the spoken text', () => {
        const segments = parseFishMarkup('晚安啦[停顿 0.5s][加重]今天辛苦你了[/加重]，早点休息');
        expect(segments).toEqual([
            { kind: 'speech', text: '晚安啦', emphasis: false },
            { kind: 'pause', ms: 500 },
            { kind: 'speech', text: '今天辛苦你了', emphasis: true },
            { kind: 'speech', text: '，早点休息', emphasis: false },
        ]);
        expect(hasFineControl(segments)).toBe(true);
        expect(flattenMarkup(segments)).toBe('晚安啦……今天辛苦你了，早点休息');
        expect(hasFineControl(parseFishMarkup('只是普通的一句话'))).toBe(false);
    });

    it('synthesizes marked text in segments and stitches real silence', async () => {
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(Buffer.from('mp3'), { status: 200 })));
        vi.stubGlobal('fetch', fetchMock);
        const result = await service([profile({ type: 'fishaudio', model: 's2.1-pro' })])
            .synthesize(conversation, '晚安[停顿 1s][加重]好好休息[/加重]');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(createSilence).toHaveBeenCalledWith(expect.stringContaining('-part-'), 1);
        expect(concatAudio).toHaveBeenCalled();
        const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
        expect(bodies[0].text).toBe('晚安');
        expect(bodies[1].text).toBe('好好休息');
        expect(bodies[1].prosody.volume).toBe(2);
        expect(bodies.every((body) => !body.text.includes('['))).toBe(true);
        expect(result.path).toContain('.mp3');
    });

    it('falls back to a single request with ellipses when ffmpeg is unavailable', async () => {
        vi.mocked(createSilence).mockResolvedValueOnce(false);
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(Buffer.from('mp3'), { status: 200 })));
        vi.stubGlobal('fetch', fetchMock);
        await service([profile({ type: 'fishaudio', model: 's2.1-pro' })]).synthesize(conversation, '晚安[停顿]早点睡');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.text).toBe('晚安……早点睡');
    });
});

describe('markup handling for non-Fish providers', () => {
    it('strips pause and emphasis markers before calling other TTS providers', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('mp3'), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await service([profile({ model: 'tts-1' })]).synthesize(conversation, '晚安[停顿 1s][加重]早点休息[/加重]');
        const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
        expect(body.input).not.toContain('[停顿');
        expect(body.input).not.toContain('[加重');
        expect(body.input).toContain('早点休息');
    });
});
