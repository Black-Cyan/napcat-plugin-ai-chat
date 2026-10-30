import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerCommandService } from '../services/security/owner-commands';
import { AccessControlService } from '../services/security/access-control-service';
import type { Store } from '../database/store';
import type { Conversation } from '../types';
import type { NormalizedIncoming } from '../napcat/message-segments';
import { pluginState } from '../core/state';
import * as napcatActions from '../napcat/actions';

function makeConversation(): Conversation {
    return {
        id: 'c-owner',
        type: 'private',
        targetId: '10001',
        title: 'Owner',
        nextSeq: 1,
        override: {},
        promptProfileId: null,
        providerProfileId: null,
        botRounds: 0,
        createdAt: 1,
        updatedAt: 1,
    };
}

function makeIncoming(text: string, userId = '10001'): NormalizedIncoming {
    return {
        type: 'private',
        targetId: userId,
        title: 'Owner',
        userId,
        senderName: 'Owner',
        senderKind: 'human',
        messageId: 'msg-1',
        segments: [{ type: 'text', data: { text } }],
        rawEvent: {},
        occurredAt: Date.now(),
        mentionedBot: false,
        repliedMessageId: null,
    };
}

describe('OwnerCommandService access control commands', () => {
    let sentMessages: string[] = [];
    let state = {
        mode: 'whitelist' as const,
        activeBlacklistId: null as string | null,
        activeWhitelistId: null as string | null,
    };
    let lists: any[] = [];
    let listMembers: any[] = [];

    let tmpDir = '';

    beforeEach(() => {
        sentMessages = [];
        state = {
            mode: 'whitelist',
            activeBlacklistId: null,
            activeWhitelistId: null,
        };
        lists = [];
        listMembers = [];

        tmpDir = path.join(os.tmpdir(), `napcat-cmd-test-${Date.now()}-${Math.random()}`);
        pluginState.init({
            dataPath: tmpDir,
            configPath: path.join(tmpDir, 'config.json'),
            adapterName: 'test',
            pluginManager: { config: {} },
            actions: { call: vi.fn() },
            logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
            NapCatConfig: {} as any,
            router: {} as any,
            pluginName: 'test',
            pluginPath: tmpDir,
        } as any);

        pluginState.config.owners = ['10001'];
        pluginState.config.commandPrefix = '#';

        vi.spyOn(napcatActions, 'sendMessage').mockImplementation(async (_ctx, _conv, segments) => {
            const text = segments.map((s) => s.data.text).join('');
            sentMessages.push(text);
            return { messageId: 'reply-1' };
        });
    });

    afterEach(() => {
        pluginState.cleanup();
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    function mockStore(): Store {
        return {
            getAccessControlState: vi.fn().mockImplementation(async () => state),
            setAccessControlState: vi.fn().mockImplementation(async (patch) => {
                state = { ...state, ...patch };
                return state;
            }),
            ensureActiveList: vi.fn().mockImplementation(async (type, name) => {
                const activeId = type === 'blacklist' ? state.activeBlacklistId : state.activeWhitelistId;
                if (activeId) return activeId;
                const listId = `list-${type}`;
                lists.push({ id: listId, type, name, description: '' });
                if (type === 'blacklist') state.activeBlacklistId = listId;
                else state.activeWhitelistId = listId;
                return listId;
            }),
            addAccessListMembers: vi.fn().mockImplementation(async (listId, members) => {
                for (const m of members) {
                    listMembers.push({ listId, ...m });
                }
                return { added: members.length, skipped: 0 };
            }),
            removeAccessListMember: vi.fn().mockImplementation(async (listId, subjectType, subjectId) => {
                listMembers = listMembers.filter(
                    (m) => !(m.listId === listId && m.subjectType === subjectType && m.subjectId === subjectId),
                );
            }),
            getAccessPolicySnapshot: vi.fn().mockImplementation(async () => ({
                mode: state.mode,
                activeBlacklistId: state.activeBlacklistId,
                activeWhitelistId: state.activeWhitelistId,
                activeBlacklistName: null,
                activeWhitelistName: null,
                userBlacklist: listMembers.filter((m) => m.listId === state.activeBlacklistId && m.subjectType === 'user').map((m) => m.subjectId),
                groupBlacklist: listMembers.filter((m) => m.listId === state.activeBlacklistId && m.subjectType === 'group').map((m) => m.subjectId),
                userWhitelist: listMembers.filter((m) => m.listId === state.activeWhitelistId && m.subjectType === 'user').map((m) => m.subjectId),
                groupWhitelist: listMembers.filter((m) => m.listId === state.activeWhitelistId && m.subjectType === 'group').map((m) => m.subjectId),
            })),
        } as unknown as Store;
    }

    it('queries and switches running mode with #运行模式', async () => {
        const store = mockStore();
        const accessControl = new AccessControlService(store);
        await accessControl.init();
        const service = new OwnerCommandService(store, accessControl, {} as any);

        await service.handle(makeIncoming('#运行模式'), makeConversation());
        expect(sentMessages[0]).toBe('当前运行模式：白名单模式');

        await service.handle(makeIncoming('#运行模式 黑名单'), makeConversation());
        expect(sentMessages[1]).toContain('已切换为黑名单模式');
        expect(state.mode).toBe('blacklist');

        await service.handle(makeIncoming('#运行模式 白名单'), makeConversation());
        expect(sentMessages[2]).toContain('已切换为白名单模式');
        expect(state.mode).toBe('whitelist');
    });

    it('adds and removes users/groups to whitelist with #允许用户 and #允许群', async () => {
        const store = mockStore();
        const accessControl = new AccessControlService(store);
        await accessControl.init();
        const service = new OwnerCommandService(store, accessControl, {} as any);

        await service.handle(makeIncoming('#允许用户 0020002'), makeConversation());
        expect(sentMessages[0]).toBe('已加入白名单');
        expect(listMembers).toContainEqual(expect.objectContaining({ subjectType: 'user', subjectId: '20002' }));

        await service.handle(makeIncoming('#允许群 0030003'), makeConversation());
        expect(sentMessages[1]).toBe('已加入白名单');
        expect(listMembers).toContainEqual(expect.objectContaining({ subjectType: 'group', subjectId: '30003' }));

        await service.handle(makeIncoming('#解除允许用户 20002'), makeConversation());
        expect(sentMessages[2]).toBe('已从白名单中移除');

        await service.handle(makeIncoming('#解除允许群 30003'), makeConversation());
        expect(sentMessages[3]).toBe('已从白名单中移除');
    });

    it('adds and removes users/groups to blacklist with clean messages', async () => {
        const store = mockStore();
        const accessControl = new AccessControlService(store);
        await accessControl.init();
        const service = new OwnerCommandService(store, accessControl, {} as any);

        await service.handle(makeIncoming('#拉黑用户 40004'), makeConversation());
        expect(sentMessages[0]).toBe('已加入黑名单');

        await service.handle(makeIncoming('#拉黑群 50005'), makeConversation());
        expect(sentMessages[1]).toBe('已加入黑名单');

        await service.handle(makeIncoming('#解除拉黑用户 40004'), makeConversation());
        expect(sentMessages[2]).toBe('已从黑名单中移除');

        await service.handle(makeIncoming('#解除拉黑群 50005'), makeConversation());
        expect(sentMessages[3]).toBe('已从黑名单中移除');
    });

    it('guards against blacklisting the last owner', async () => {
        const store = mockStore();
        const accessControl = new AccessControlService(store);
        await accessControl.init();
        const service = new OwnerCommandService(store, accessControl, {} as any);

        await service.handle(makeIncoming('#拉黑用户 10001'), makeConversation());
        expect(sentMessages[0]).toContain('不能拉黑最后一个所有者');
    });
});
