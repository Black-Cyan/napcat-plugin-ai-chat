import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextComposer } from '../services/context/context-composer';
import { ParticipantAliases } from '../services/chat/participants';
import { SocialService } from '../services/social/social-service';
import { pluginState } from '../core/state';
import { createDefaultConfig } from '../config';
import type { Store } from '../database/store';
import type { ChatMessage, Conversation, ProviderProfile, UserSocialRelation } from '../types';

const conversation: Conversation = {
    id: 'c1', type: 'group', targetId: '574551365', title: 'Furminal', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};
const message = (senderId: string): ChatMessage => ({
    id: 'm1', conversationId: 'c1', seq: 1, batchId: 'b1', napcatMessageId: 'n1',
    senderId, senderName: 'Alice', senderKind: 'human', role: 'user',
    content: [{ type: 'text', data: { text: 'hello' } }], rawEvent: {}, occurredAt: 1, receivedAt: 1,
});
const profile: ProviderProfile = {
    id: 'p1', name: 'Main', type: 'google', model: 'm', apiKey: 'k', contextWindow: 100000,
    maxOutputTokens: 1000, temperature: 0.7, vision: true, toolCalling: true, structuredOutput: true,
};

let store: {
    getPrompt: ReturnType<typeof vi.fn>;
    getSummary: ReturnType<typeof vi.fn>;
    getRecentMessages: ReturnType<typeof vi.fn>;
    getProfiles: ReturnType<typeof vi.fn>;
};
let social: {
    getBatchSocialProfiles: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    pluginState.config = createDefaultConfig();
    pluginState.selfId = 'bot-self';
    store = {
        getPrompt: vi.fn().mockResolvedValue(null),
        getSummary: vi.fn().mockResolvedValue({ content: '', coveredThroughSeq: 0 }),
        getRecentMessages: vi.fn().mockResolvedValue([]),
        getProfiles: vi.fn().mockResolvedValue([]),
    };
    social = {
        getBatchSocialProfiles: vi.fn().mockResolvedValue(new Map<string, UserSocialRelation>()),
    };
});

describe('Social context injection (Phase 2)', () => {
    it('does NOT inject social relationship table when social system is disabled', async () => {
        pluginState.config.social.enabled = false;
        const composer = new ContextComposer(store as unknown as Store, { relevant: vi.fn().mockResolvedValue([]) } as any, {} as any, social as unknown as SocialService);
        const msgs = [message('10001')];
        const composed = await composer.compose(conversation, msgs, new ParticipantAliases(msgs), profile);

        const system = (composed.messages[0].content[0] as any).text;
        expect(system).not.toContain('参与者社交关系');
        expect(social.getBatchSocialProfiles).not.toHaveBeenCalled();
    });

    it('injects structured social relation table with only participant, affection, and familiarity (NO QQ or UUID)', async () => {
        pluginState.config.social.enabled = true;
        social.getBatchSocialProfiles.mockResolvedValue(new Map([
            ['10001', {
                botId: 'bot-self',
                userId: 'uuid-12345678-abcd',
                affection: 35,
                familiarityExp: 150,
                familiarityLevel: 3,
                firstInteractedAt: 1,
                lastInteractedAt: 1,
                createdAt: 1,
                updatedAt: 1,
            }],
        ]));

        const composer = new ContextComposer(store as unknown as Store, { relevant: vi.fn().mockResolvedValue([]) } as any, {} as any, social as unknown as SocialService);
        const msgs = [message('10001')];
        const composed = await composer.compose(conversation, msgs, new ParticipantAliases(msgs), profile);

        const system = (composed.messages[0].content[0] as any).text;
        expect(system).toContain('参与者社交关系');
        expect(system).toContain('"participant":"p1"');
        expect(system).toContain('"affection":35');
        expect(system).toContain('"familiarity":"Lv3"');

        // CRITICAL SECURITY ASSERTION: Never leak QQ or internal UUID into system prompt!
        expect(system).not.toContain('10001');
        expect(system).not.toContain('uuid-12345678-abcd');
    });

    it('restricts social profiles query strictly to current batch participants (Option A)', async () => {
        pluginState.config.social.enabled = true;
        social.getBatchSocialProfiles.mockResolvedValue(new Map());

        const historyMsg = message('99999');
        historyMsg.seq = 1;
        store.getRecentMessages.mockResolvedValue([historyMsg]);

        const composer = new ContextComposer(store as unknown as Store, { relevant: vi.fn().mockResolvedValue([]) } as any, {} as any, social as unknown as SocialService);
        const currentMsgs = [message('10001')]; // only 10001 is active in current batch
        await composer.compose(conversation, currentMsgs, new ParticipantAliases(currentMsgs), profile);

        // Crucial: only current batch sender '10001' should be queried, not '99999' from history
        expect(social.getBatchSocialProfiles).toHaveBeenCalledWith('bot-self', ['10001']);
    });
});
