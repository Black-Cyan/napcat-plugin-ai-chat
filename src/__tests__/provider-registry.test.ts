import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRegistry } from '../providers/registry';
import { textMessage } from '../providers/types';
import type { ProviderProfile } from '../types';

afterEach(() => vi.unstubAllGlobals());

describe('provider streaming isolation', () => {
    it('keeps unary behavior for providers without a stream adapter', async () => {
        const profile: ProviderProfile = {
            id: 'openai', name: 'OpenAI', type: 'openai', model: 'test', apiKey: 'secret',
            contextWindow: 1000, maxOutputTokens: 100, temperature: 0.7,
            vision: false, toolCalling: false, structuredOutput: false,
        };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {},
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const registry = new ProviderRegistry(() => [profile]);
        const result = await registry.generate(profile, { profile, messages: [textMessage('user', 'hello')], stream: true });
        expect(result.text).toBe('ok');
        expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
        expect(String(fetchMock.mock.calls[0][0])).not.toContain('streamGenerateContent');
    });
});
