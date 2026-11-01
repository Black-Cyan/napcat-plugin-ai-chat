import { describe, expect, it } from 'vitest';
import { capabilitiesOf, isSpeechOnly, isTtsOnly } from '../providers/capabilities';
import type { ProviderProfile } from '../types';

const profile = (patch: Partial<ProviderProfile>): ProviderProfile => ({
    id: 'p', name: 'p', type: 'openai', model: 'gpt-4o-mini', apiKey: 'k', contextWindow: 1000,
    maxOutputTokens: 100, temperature: 0.7, vision: true, toolCalling: true, structuredOutput: true, ...patch,
});

describe('provider capability derivation', () => {
    it('derives Fish Audio usage from the single configured model', () => {
        expect(capabilitiesOf(profile({ type: 'fishaudio', model: 's2.1-pro' })))
            .toEqual({ chat: false, vision: false, tts: true, stt: false });
        expect(capabilitiesOf(profile({ type: 'fishaudio', model: 'transcribe-1-pro' })))
            .toEqual({ chat: false, vision: false, tts: false, stt: true });
        expect(isSpeechOnly(profile({ type: 'fishaudio', model: 'transcribe-1-pro' }))).toBe(true);
    });

    it('detects TTS and STT models by name without manual declarations', () => {
        expect(isTtsOnly(profile({ model: 'tts-1' }))).toBe(true);
        expect(isTtsOnly(profile({ model: 'gpt-4o-mini-tts' }))).toBe(true);
        expect(isTtsOnly(profile({ model: 'gemini-3.8-flash-tts', type: 'google' }))).toBe(true);
        expect(capabilitiesOf(profile({ model: 'whisper-1' })).stt).toBe(true);
        expect(capabilitiesOf(profile({ model: 'whisper-1' })).chat).toBe(false);
    });

    it('keeps ordinary chat models fully usable', () => {
        const capabilities = capabilitiesOf(profile({ model: 'doubao-seed-2.0-mini' }));
        expect(capabilities.chat).toBe(true);
        expect(capabilities.tts).toBe(false);
        expect(isTtsOnly(profile({ model: 'gemini-3.5-flash-lite', type: 'google' }))).toBe(false);
    });

    it('honours manual overrides and blocks vision on speech-only models', () => {
        expect(isTtsOnly(profile({ model: 'custom-model', tts: true }))).toBe(true);
        expect(capabilitiesOf(profile({ model: 'whisper-1' })).vision).toBe(false);
        expect(capabilitiesOf(profile({ model: 'custom', speechRecognition: true })).stt).toBe(true);
    });
});
