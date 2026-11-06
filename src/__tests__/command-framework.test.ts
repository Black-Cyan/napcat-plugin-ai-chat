import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandService } from '../services/command/command-service';
import { pluginState } from '../core/state';
import { createDefaultConfig } from '../config';
import type { Store } from '../database/store';
import type { Conversation } from '../types';
import type { NormalizedIncoming } from '../napcat/message-segments';
import * as napcatActions from '../napcat/actions';

function makeConv(type: 'private' | 'group' = 'group', targetId = '574551365'): Conversation {
    return {
        id: `c-${type}`, type, targetId, title: 'Chat', nextSeq: 1, override: {},
        promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
    };
}

function makeIncoming(text: string, userId = '10001', type: 'private' | 'group' = 'group', targetId = '574551365', extraSegments: any[] = []): NormalizedIncoming {
    return {
        type, targetId, title: 'Chat', userId, senderName: `User-${userId}`, senderKind: 'human',
        messageId: 'msg-1',
        segments: [{ type: 'text', data: { text } }, ...extraSegments],
        rawEvent: {}, occurredAt: Date.now(),
        mentionedBot: false, repliedMessageId: null,
    };
}

let store: any;
let accessControl: any;
let social: any;
let speech: any;
let sentMessages: string[] = [];

beforeEach(() => {
    sentMessages = [];
    vi.spyOn(napcatActions, 'sendMessage').mockImplementation(async (_ctx, _conv, segments) => {
        const text = segments.map((s) => s.type === 'text' ? s.data.text : s.type === 'at' ? `@${s.data.qq}` : '').join('');
        sentMessages.push(text);
        return { messageId: '1' };
    });

    pluginState.setContextForTest({
        dataPath: '/tmp', configPath: '/tmp/cfg.json', adapterName: 'test',
        pluginManager: { config: {} }, actions: { call: vi.fn().mockResolvedValue({}) },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    } as any);
    pluginState.config = createDefaultConfig();
    pluginState.config.owners = ['10001'];
    pluginState.config.social.enabled = true;
    pluginState.selfId = 'bot-self';

    store = {
        getAccessControlState: vi.fn().mockResolvedValue({ mode: 'whitelist', activeBlacklistId: null, activeWhitelistId: 'wl-1' }),
        ensureActiveList: vi.fn().mockResolvedValue('wl-1'),
        addAccessListMembers: vi.fn().mockResolvedValue({ added: 1 }),
        removeAccessListMember: vi.fn().mockResolvedValue(undefined),
        getOrCreateUserIdentity: vi.fn().mockImplementation(async (_p, extId) => `uuid-${extId}`),
        getOrCreateSocialRelation: vi.fn().mockImplementation(async (_b, userId) => ({
            botId: 'bot-self', userId, affection: 20, familiarityExp: 85, familiarityLevel: 3,
        })),
        applySocialEvent: vi.fn().mockImplementation(async (input: any) => ({ affection: input.affectionDelta ?? 20, familiarityExp: input.expDelta ?? 85, familiarityLevel: 3 })),
        resetSocialRelation: vi.fn().mockResolvedValue(undefined),
        countSocialRelations: vi.fn().mockResolvedValue(5),
        findConversationByTargetId: vi.fn().mockImplementation(async (tid) => ({ id: `c-${tid}`, title: `Conv-${tid}` })),
        resetSummary: vi.fn().mockResolvedValue(undefined),
    };
    accessControl = {
        getSnapshot: vi.fn().mockReturnValue({ mode: 'whitelist' }),
        setMode: vi.fn().mockResolvedValue(undefined),
        refresh: vi.fn().mockResolvedValue(undefined),
        isAllowed: vi.fn().mockReturnValue(true),
    };
    social = {
        getBatchSocialProfiles: vi.fn().mockResolvedValue(new Map()),
    };
    speech = {
        sendVoice: vi.fn().mockResolvedValue({ messageId: 'v1', fallback: false }),
    };
});

afterEach(() => {
    pluginState.setContextForTest(null);
    vi.restoreAllMocks();
});

describe('CommandService framework (Phase 3)', () => {
    it('regular user querying self status in group chat receives concise single-line reply with mention', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incoming = makeIncoming('#社交', '20002', 'group'); // 20002 is regular user
        const handled = await service.handle(incoming, makeConv('group'));

        expect(handled).toBe(true);
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toContain('@20002');
        expect(sentMessages[0]).toContain('好感度: 20');
        expect(sentMessages[0]).toContain('熟识度: Lv3');
    });

    it('enforces 60s cooldown for regular user querying #社交 in group chat', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incoming = makeIncoming('#社交', '20002', 'group');
        await service.handle(incoming, makeConv('group'));
        expect(sentMessages).toHaveLength(1);

        // Immediate subsequent query within 60s should be silently dropped or throttled
        const handled2 = await service.handle(incoming, makeConv('group'));
        expect(handled2).toBe(true);
        expect(sentMessages).toHaveLength(1); // not spammed again
    });

    it('silently ignores unknown commands in group chat to avoid noise', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incoming = makeIncoming('#今日打卡', '20002', 'group');
        const handled = await service.handle(incoming, makeConv('group'));

        expect(handled).toBe(false); // falls through to regular chat
        expect(sentMessages).toHaveLength(0); // 0 reply
    });

    it('silently blocks non-owner from executing admin commands in group chat', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incoming = makeIncoming('#名单 拉黑 用户 30003', '20002', 'group'); // 20002 is non-owner
        const handled = await service.handle(incoming, makeConv('group'));

        expect(handled).toBe(false);
        expect(sentMessages).toHaveLength(0); // completely silent
        expect(store.addAccessListMembers).not.toHaveBeenCalled();
    });

    it('allows owner to adjust affection with target QQ number or @mention', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        // Owner 10001 adjusts affection via QQ number
        const incoming1 = makeIncoming('#社交 调好感 20002 +15', '10001', 'group');
        await service.handle(incoming1, makeConv('group'));
        expect(store.applySocialEvent).toHaveBeenCalledWith(expect.objectContaining({
            botId: 'bot-self',
            userId: 'uuid-20002',
            eventType: 'admin_adjust',
            affectionDelta: 15,
        }));
        expect(sentMessages[0]).toContain('已调整');

        // Owner 10001 adjusts affection via @mention
        const incoming2 = makeIncoming('#社交 调好感 -5', '10001', 'group', '574551365', [{ type: 'at', data: { qq: '30003' } }]);
        await service.handle(incoming2, makeConv('group'));
        expect(store.applySocialEvent).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'uuid-30003',
            affectionDelta: -5,
        }));
    });

    it('requires two-stage confirmation (#确认 <token>) for high-risk reset operations', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incomingReset = makeIncoming('#社交 重置 20002', '10001', 'group');
        await service.handle(incomingReset, makeConv('group'));

        expect(store.resetSocialRelation).not.toHaveBeenCalled();
        expect(sentMessages[0]).toContain('#确认');
        const tokenMatch = sentMessages[0].match(/#确认\s+(\d{6})/);
        expect(tokenMatch).not.toBeNull();
        const token = tokenMatch![1];

        // Another user trying to confirm should be rejected
        const fraudConfirm = makeIncoming(`#确认 ${token}`, '20002', 'group');
        await service.handle(fraudConfirm, makeConv('group'));
        expect(store.resetSocialRelation).not.toHaveBeenCalled();

        // Valid owner in same conversation confirms
        const validConfirm = makeIncoming(`#确认 ${token}`, '10001', 'group');
        await service.handle(validConfirm, makeConv('group'));
        expect(store.resetSocialRelation).toHaveBeenCalledWith('bot-self', 'uuid-20002', expect.any(String));
        expect(sentMessages[sentMessages.length - 1]).toContain('已重置');
    });

    it('provides tiered help: regular users see only self commands, owners see full command tree', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);

        // Regular user help
        await service.handle(makeIncoming('#帮助', '20002', 'group'), makeConv('group'));
        expect(sentMessages[0]).toContain('#社交');
        expect(sentMessages[0]).not.toContain('#名单');

        // Owner help
        await service.handle(makeIncoming('#帮助', '10001', 'private'), makeConv('private'));
        expect(sentMessages[1]).toContain('#社交');
        expect(sentMessages[1]).toContain('#名单');
        expect(sentMessages[1]).toContain('#会话');
        expect(sentMessages[1]).toContain('#系统');
    });

    it('supports #重置摘要 direct command alias to reset conversation summary', async () => {
        const service = new CommandService(store, accessControl, {} as any, speech, social);
        const incoming = makeIncoming('#重置摘要', '10001', 'group');
        const handled = await service.handle(incoming, makeConv('group'));
        expect(handled).toBe(true);
        expect(store.resetSummary).toHaveBeenCalledWith('c-group');
        expect(sentMessages[sentMessages.length - 1]).toContain('已重置');
    });
});
