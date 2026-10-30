import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIAdapter, AnthropicAdapter, GoogleAdapter } from '../providers/http';
import { textMessage } from '../providers/types';
import type { ProviderProfile } from '../types';
import { clearGoogleModelCache } from '../providers/google/models';

const profile = (type: ProviderProfile['type']): ProviderProfile => ({
    id: type, name: type, type, model: 'test-model', apiKey: 'secret', contextWindow: 128000,
    maxOutputTokens: 100, temperature: 0.7, vision: true, toolCalling: true, structuredOutput: true,
});

beforeEach(() => { vi.unstubAllGlobals(); clearGoogleModelCache(); });
afterEach(() => vi.unstubAllGlobals());

describe('provider protocol adapters', () => {
    it('maps neutral tools to OpenAI Chat Completions', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: '', tool_calls: [{ id: 'call1', function: { name: 'poke', arguments: '{"participant":"p1"}' } }] }, finish_reason: 'tool_calls' }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await new OpenAIAdapter().generate({
            profile: profile('openai'), messages: [textMessage('user', 'hello')],
            tools: [{ name: 'poke', description: 'poke', parameters: { type: 'object' } }],
        });
        expect(result.toolCalls[0]).toEqual({ id: 'call1', name: 'poke', arguments: { participant: 'p1' } });
        expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages[0].role).toBe('user');
    });

    it('maps Anthropic tool_use responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            content: [{ type: 'tool_use', id: 'tool1', name: 'poke', input: { participant: 'p1' } }], stop_reason: 'tool_use',
        }), { status: 200 })));
        const result = await new AnthropicAdapter().generate({ profile: profile('anthropic'), messages: [textMessage('user', 'hello')] });
        expect(result.toolCalls[0].name).toBe('poke');
    });

    it('maps Gemini functionCall responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation((url) => {
            if (String(url).includes('/models?')) return Promise.resolve(new Response(JSON.stringify({
                models: [{ name: 'models/test-model', baseModelId: 'test-model', supportedGenerationMethods: ['generateContent'] }],
            }), { status: 200 }));
            return Promise.resolve(new Response(JSON.stringify({
                candidates: [{ content: { parts: [{ functionCall: { name: 'poke', args: { participant: 'p1' } } }] }, finishReason: 'STOP' }],
            }), { status: 200 }));
        }));
        const result = await new GoogleAdapter().generate({ profile: profile('google'), messages: [textMessage('user', 'hello')] });
        expect(result.toolCalls[0].arguments).toEqual({ participant: 'p1' });
    });
});
