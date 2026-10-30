import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearGoogleModelCache, discoverGoogleModels, fetchGoogleModels, selectGoogleModel } from '../providers/google/models';
import type { ProviderProfile } from '../types';

const profile = (patch: Partial<ProviderProfile> = {}): ProviderProfile => ({
    id: 'google-1', name: 'Google', type: 'google', model: 'gemini-chat', apiKey: 'secret-key',
    contextWindow: 128000, maxOutputTokens: 4096, temperature: 0.7,
    vision: true, toolCalling: true, structuredOutput: true, ...patch,
});
const model = (name: string, methods = ['generateContent']) => ({
    name: `models/${name}`, baseModelId: name, displayName: name,
    supportedGenerationMethods: methods, inputTokenLimit: 100000, outputTokenLimit: 8192,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { clearGoogleModelCache(); vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Google model discovery', () => {
    it('paginates, filters generateContent models, and keeps keys out of URLs', async () => {
        const fetchMock = vi.fn().mockImplementation((url) => {
            const target = new URL(String(url));
            if (target.searchParams.get('pageToken') === 'next') {
                return Promise.resolve(json({ models: [model('embedding-model', ['embedContent'])] }));
            }
            return Promise.resolve(json({ models: [model('gemini-chat'), model('embedding-only', ['embedContent'])], nextPageToken: 'next' }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const models = await fetchGoogleModels(profile());
        expect(models.map((item) => item.baseModelId)).toEqual(['gemini-chat']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).not.toContain('secret-key');
        expect(init.headers['x-goog-api-key']).toBe('secret-key');
    });

    it('uses TTL caching, bypasses it on refresh, and isolates credentials', async () => {
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ models: [model('gemini-chat')] })));
        vi.stubGlobal('fetch', fetchMock);
        await discoverGoogleModels(profile());
        const cached = await discoverGoogleModels(profile());
        expect(cached.cached).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await discoverGoogleModels(profile(), { forceRefresh: true });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await discoverGoogleModels(profile({ apiKey: 'another-key' }));
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('returns stale data with a visible warning after expiry failures', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        const fetchMock = vi.fn().mockResolvedValueOnce(json({ models: [model('gemini-chat')] }))
            .mockResolvedValueOnce(json({ error: { status: 'UNAUTHENTICATED', message: 'secret-key denied' } }, 401));
        vi.stubGlobal('fetch', fetchMock);
        await discoverGoogleModels(profile());
        vi.setSystemTime(1000 + 6 * 60 * 1000);
        const result = await discoverGoogleModels(profile());
        expect(result.stale).toBe(true);
        expect(result.models).toHaveLength(1);
        expect(result.error).toContain('鉴权失败');
        expect(result.error).not.toContain('secret-key');
    });

    it('distinguishes an empty usable model list and rejects generation selection', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ models: [model('embedding-only', ['embedContent'])] })));
        const result = await discoverGoogleModels(profile());
        expect(result.models).toEqual([]);
        await expect(selectGoogleModel(profile())).rejects.toThrow('没有可用于聊天');
    });

    it('sanitizes initial authentication failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { status: 'UNAUTHENTICATED', message: 'secret-key denied' } }, 401)));
        await expect(discoverGoogleModels(profile())).rejects.toThrow('鉴权失败');
        await expect(discoverGoogleModels(profile())).rejects.not.toThrow('secret-key');
    });
});
