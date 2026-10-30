import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAdapter } from '../providers/google/adapter';
import { clearGoogleModelCache } from '../providers/google/models';
import { textMessage, textPart } from '../providers/types';
import type { ProviderProfile } from '../types';

const profile = (patch: Partial<ProviderProfile> = {}): ProviderProfile => ({
    id: 'google-adapter', name: 'Google', type: 'google', model: 'test-model', apiKey: 'secret',
    contextWindow: 128000, maxOutputTokens: 100, temperature: 0.7,
    vision: true, toolCalling: true, structuredOutput: true, ...patch,
});
const catalog = [{ name: 'models/test-model', baseModelId: 'test-model', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000, outputTokenLimit: 50 }];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const okResponse = {
    candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }],
};

function mockGoogle(response: (url: string) => Response | Promise<Response>, models: unknown[] = catalog) {
    return vi.fn().mockImplementation((url: string) => {
        if (url.includes('/models?')) return Promise.resolve(json({ models }));
        return Promise.resolve(response(url));
    });
}

beforeEach(() => { clearGoogleModelCache(); vi.unstubAllGlobals(); });
afterEach(() => vi.unstubAllGlobals());

describe('Google native generateContent', () => {
    it('constructs native requests, applies model limits, and preserves usage and signatures', async () => {
        const fetchMock = mockGoogle(() => json({
            candidates: [{
                content: { role: 'model', parts: [
                    { text: 'answer', thoughtSignature: 'text-signature' },
                    { functionCall: { id: 'native-call', name: 'poke', args: { participant: 'p1' } }, thoughtSignature: 'call-signature' },
                ] },
                finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 15 },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await new GoogleAdapter().generate({
            profile: profile(),
            messages: [
                textMessage('system', 'safe rules'),
                { role: 'user', content: [textPart('look'), { type: 'image', mime: 'image/png', data: 'aGVsbG8=' }] },
            ],
            tools: [{ name: 'poke', description: 'poke', parameters: { type: 'object' } }],
            responseSchema: { type: 'object', additionalProperties: false },
        });
        const [url, init] = fetchMock.mock.calls.find(([target]) => String(target).includes(':generateContent'))!;
        const body = JSON.parse(String(init.body));
        expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
        expect(init.headers['x-goog-api-key']).toBe('secret');
        expect(String(url)).not.toContain('secret');
        expect(body.systemInstruction.parts[0].text).toBe('safe rules');
        expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'aGVsbG8=' });
        expect(body.generationConfig.maxOutputTokens).toBe(50);
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        expect(body.generationConfig.responseSchema.additionalProperties).toBeUndefined();
        expect(body.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual({ type: 'object' });
        expect(result.toolCalls[0].id).toBe('native-call');
        expect(result.toolCalls[0].raw).toMatchObject({ thoughtSignature: 'call-signature' });
        expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, thoughtTokens: 2, totalTokens: 15 });
        expect(result.raw).toMatchObject({ role: 'model' });
    });

    it('omits empty system instructions and auto-selects the first available model', async () => {
        const fetchMock = mockGoogle(() => json(okResponse));
        vi.stubGlobal('fetch', fetchMock);
        await new GoogleAdapter().generate({ profile: profile({ model: '' }), messages: [textMessage('user', 'hello')] });
        const [url, init] = fetchMock.mock.calls.find(([target]) => String(target).includes(':generateContent'))!;
        expect(String(url)).toContain('/models/test-model:generateContent');
        expect(JSON.parse(String(init.body)).systemInstruction).toBeUndefined();
    });

    it('replays native thought parts and groups correlated function responses', async () => {
        const fetchMock = mockGoogle(() => json(okResponse));
        vi.stubGlobal('fetch', fetchMock);
        const rawPart = { functionCall: { id: 'native-call', name: 'poke', args: {} }, thoughtSignature: 'signed' };
        const rawContent = { role: 'model', parts: [rawPart] };
        await new GoogleAdapter().generate({
            profile: profile(),
            messages: [
                textMessage('user', 'hello'),
                { role: 'assistant', content: [], raw: rawContent, toolCalls: [{ id: 'native-call', name: 'poke', arguments: {}, raw: rawPart }] },
                { role: 'tool', content: [textPart('{"ok":true}')], toolCallId: 'native-call', toolName: 'poke', raw: rawPart },
                { role: 'tool', content: [textPart('{"ok":true}')], toolCallId: 'generated-local-id', toolName: 'other' },
            ],
        });
        const [, init] = fetchMock.mock.calls.find(([target]) => String(target).includes(':generateContent'))!;
        const body = JSON.parse(String(init.body));
        expect(body.contents[1].parts[0]).toEqual(rawPart);
        expect(body.contents[2].parts).toHaveLength(2);
        expect(body.contents[2].parts[0].functionResponse).toMatchObject({ id: 'native-call', name: 'poke', response: { result: { ok: true } } });
        expect(body.contents[2].parts[1].functionResponse.id).toBeUndefined();
    });

    it('converts GIF input to PNG inside the Google boundary', async () => {
        const fetchMock = mockGoogle(() => json(okResponse));
        vi.stubGlobal('fetch', fetchMock);
        const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        await new GoogleAdapter().generate({
            profile: profile(), messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/gif', data: gif }] }],
        });
        const [, init] = fetchMock.mock.calls.find(([target]) => String(target).includes(':generateContent'))!;
        const part = JSON.parse(String(init.body)).contents[0].parts[0];
        expect(part.inlineData.mimeType).toBe('image/png');
        expect(part.inlineData.data).not.toBe(gif);
    });
});

describe('Google streaming and errors', () => {
    it('aggregates fragmented SSE, filters thoughts, and keeps final usage', async () => {
        const events = [
            'data: {"candidates":[{"content":{"parts":[{"text":"visible"}]}}]}\n\n',
            'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"functionCall":{"id":"stream-call","name":"poke","args":{}},"thoughtSignature":"signed"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"thoughtsTokenCount":1}}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        const bytes = new TextEncoder().encode(events);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const [start, end] of [[0, 11], [11, 47], [47, bytes.length]]) controller.enqueue(bytes.slice(start, end));
                controller.close();
            },
        });
        const fetchMock = mockGoogle(() => new Response(stream, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await new GoogleAdapter().generateStream!({ profile: profile(), messages: [textMessage('user', 'hello')] });
        expect(result.text).toBe('visible');
        expect(result.toolCalls[0].id).toBe('stream-call');
        expect(result.toolCalls[0].raw).toMatchObject({ thoughtSignature: 'signed' });
        expect(result.usage.outputTokens).toBe(3);
        expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes(':streamGenerateContent'))![0])).toContain('alt=sse');
    });

    it('classifies input overflow separately from output limits', async () => {
        vi.stubGlobal('fetch', mockGoogle(() => json({ error: { status: 'INVALID_ARGUMENT', message: 'The input token count exceeds the maximum allowed' } }, 400)));
        const error = await new GoogleAdapter().generate({ profile: profile(), messages: [textMessage('user', 'hello')] }).catch((reason) => reason);
        expect(error.contextOverflow).toBe(true);
        expect(error.message).not.toContain('secret');
    });

    it('rejects output truncation without treating it as input overflow', async () => {
        vi.stubGlobal('fetch', mockGoogle(() => json({ candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] })));
        const error = await new GoogleAdapter().generate({ profile: profile(), messages: [textMessage('user', 'hello')] }).catch((reason) => reason);
        expect(error.contextOverflow).toBe(false);
        expect(error.message).toContain('输出达到');
    });

    it('rejects prompt blocking and empty candidates instead of completing silently', async () => {
        vi.stubGlobal('fetch', mockGoogle(() => json({ promptFeedback: { blockReason: 'SAFETY' } })));
        await expect(new GoogleAdapter().generate({ profile: profile(), messages: [textMessage('user', 'hello')] })).rejects.toThrow('阻止');
    });

    it('sanitizes authentication failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { status: 'UNAUTHENTICATED', message: 'secret denied' } }, 401)));
        const error = await new GoogleAdapter().generate({ profile: profile(), messages: [textMessage('user', 'hello')] }).catch((reason) => reason);
        expect(error.status).toBe(401);
        expect(error.message).toContain('鉴权失败');
        expect(error.message).not.toContain('secret');
    });
});
