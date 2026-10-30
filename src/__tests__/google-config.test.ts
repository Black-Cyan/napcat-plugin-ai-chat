import { describe, expect, it } from 'vitest';
import { resolveGoogleProfile } from '../services/api-service';
import { SECRET_MASK } from '../core/state';
import type { ProviderProfile } from '../types';

const saved: ProviderProfile = {
    id: 'google-saved', name: 'Saved Google', type: 'google', model: 'gemini-chat', apiKey: 'real-secret',
    baseUrl: 'https://proxy.example/v1beta', contextWindow: 1000, maxOutputTokens: 100,
    temperature: 0.5, vision: true, toolCalling: true, structuredOutput: true,
};

describe('Google draft configuration', () => {
    it('resolves masked keys locally without exposing them in draft metadata', () => {
        const resolved = resolveGoogleProfile({ id: saved.id, apiKey: SECRET_MASK, baseUrl: saved.baseUrl }, [saved]);
        expect(resolved.apiKey).toBe('real-secret');
        expect(resolved.model).toBe('gemini-chat');
        expect(resolved.baseUrl).toBe(saved.baseUrl);
    });

    it('supports unsaved official-endpoint drafts and rejects missing credentials', () => {
        const resolved = resolveGoogleProfile({ id: 'new-google', apiKey: 'draft-secret' }, []);
        expect(resolved.type).toBe('google');
        expect(resolved.baseUrl).toBeUndefined();
        expect(resolved.model).toBe('');
        expect(() => resolveGoogleProfile({ id: 'new-google', apiKey: '' }, [])).toThrow('API Key');
    });
});
