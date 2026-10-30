import { describe, expect, it, vi } from 'vitest';
import { AccessControlService } from '../services/security/access-control-service';
import type { Store } from '../database/store';
import type { AccessPolicySnapshot } from '../types';

function createMockStore(snapshot: AccessPolicySnapshot): Store {
    let currentSnapshot = { ...snapshot };
    return {
        getAccessPolicySnapshot: vi.fn().mockImplementation(async () => currentSnapshot),
        setAccessControlState: vi.fn().mockImplementation(async (patch) => {
            currentSnapshot = {
                ...currentSnapshot,
                mode: patch.mode ?? currentSnapshot.mode,
                activeBlacklistId: patch.activeBlacklistId !== undefined ? patch.activeBlacklistId : currentSnapshot.activeBlacklistId,
                activeWhitelistId: patch.activeWhitelistId !== undefined ? patch.activeWhitelistId : currentSnapshot.activeWhitelistId,
            };
            return {
                mode: currentSnapshot.mode,
                activeBlacklistId: currentSnapshot.activeBlacklistId,
                activeWhitelistId: currentSnapshot.activeWhitelistId,
            };
        }),
    } as unknown as Store;
}

describe('AccessControlService', () => {
    it('fails closed when uninitialized', () => {
        const store = createMockStore({
            mode: 'blacklist',
            activeBlacklistId: null,
            activeWhitelistId: null,
            activeBlacklistName: null,
            activeWhitelistName: null,
            userBlacklist: [],
            groupBlacklist: [],
            userWhitelist: [],
            groupWhitelist: [],
        });
        const service = new AccessControlService(store);
        // Uninitialized -> fail closed
        expect(service.isAllowed('10001')).toBe(false);
        expect(service.isAllowed('10001', '20001')).toBe(false);
    });

    it('implements whitelist mode: default deny all when no active list is selected', async () => {
        const store = createMockStore({
            mode: 'whitelist',
            activeBlacklistId: null,
            activeWhitelistId: null,
            activeBlacklistName: null,
            activeWhitelistName: null,
            userBlacklist: [],
            groupBlacklist: [],
            userWhitelist: ['10001'],
            groupWhitelist: ['20001'],
        });
        const service = new AccessControlService(store);
        await service.init();

        // activeWhitelistId is null -> default deny all!
        expect(service.isAllowed('10001')).toBe(false);
        expect(service.isAllowed('10002')).toBe(false);
        expect(service.isAllowed('10001', '20001')).toBe(false);
        expect(service.isAllowed('10002', '20002')).toBe(false);
    });

    it('implements whitelist mode: allows whitelisted users in private, and whitelisted groups in group chat', async () => {
        const store = createMockStore({
            mode: 'whitelist',
            activeBlacklistId: null,
            activeWhitelistId: 'wl-1',
            activeBlacklistName: null,
            activeWhitelistName: '工作白名单',
            userBlacklist: [],
            groupBlacklist: [],
            userWhitelist: ['10001'],
            groupWhitelist: ['20001'],
        });
        const service = new AccessControlService(store);
        await service.init();

        // Private chat: only whitelisted user is allowed
        expect(service.isAllowed('10001')).toBe(true);
        expect(service.isAllowed('0010001')).toBe(true); // Normalized leading zeroes
        expect(service.isAllowed('10002')).toBe(false);

        // Group chat: if group is whitelisted, the whole group is allowed
        expect(service.isAllowed('10001', '20001')).toBe(true);
        expect(service.isAllowed('10002', '20001')).toBe(true);
        expect(service.isAllowed('99999', '0020001')).toBe(true); // Normalized leading zeroes

        // Group chat: non-whitelisted group is blocked even if user is in user whitelist
        expect(service.isAllowed('10001', '99999')).toBe(false);
        expect(service.isAllowed('10002', '99999')).toBe(false);
    });

    it('implements blacklist mode: default allow all when no active list is selected', async () => {
        const store = createMockStore({
            mode: 'blacklist',
            activeBlacklistId: null,
            activeWhitelistId: null,
            activeBlacklistName: null,
            activeWhitelistName: null,
            userBlacklist: ['10001'],
            groupBlacklist: ['20001'],
            userWhitelist: [],
            groupWhitelist: [],
        });
        const service = new AccessControlService(store);
        await service.init();

        // activeBlacklistId is null -> default allow all!
        expect(service.isAllowed('10001')).toBe(true);
        expect(service.isAllowed('10002')).toBe(true);
        expect(service.isAllowed('10001', '20001')).toBe(true);
    });

    it('implements blacklist mode: blocks blacklisted users and groups', async () => {
        const store = createMockStore({
            mode: 'blacklist',
            activeBlacklistId: 'bl-1',
            activeWhitelistId: null,
            activeBlacklistName: '默认黑名单',
            activeWhitelistName: null,
            userBlacklist: ['10001'],
            groupBlacklist: ['20001'],
            userWhitelist: [],
            groupWhitelist: [],
        });
        const service = new AccessControlService(store);
        await service.init();

        // Blacklisted user is blocked in private
        expect(service.isAllowed('10001')).toBe(false);
        expect(service.isAllowed('0010001')).toBe(false);
        // Non-blacklisted user is allowed in private
        expect(service.isAllowed('10002')).toBe(true);

        // Blacklisted user is blocked in group as well
        expect(service.isAllowed('10001', '30001')).toBe(false);

        // Blacklisted group is blocked
        expect(service.isAllowed('10002', '20001')).toBe(false);
        expect(service.isAllowed('10002', '0020001')).toBe(false);

        // Clean user in clean group is allowed
        expect(service.isAllowed('10002', '30001')).toBe(true);
    });

    it('atomically updates mode and refreshes snapshot without wiping on failure', async () => {
        const store = createMockStore({
            mode: 'whitelist',
            activeBlacklistId: null,
            activeWhitelistId: 'wl-1',
            activeBlacklistName: null,
            activeWhitelistName: '工作白名单',
            userBlacklist: [],
            groupBlacklist: [],
            userWhitelist: ['10001'],
            groupWhitelist: [],
        });
        const service = new AccessControlService(store);
        await service.init();

        expect(service.getSnapshot()?.mode).toBe('whitelist');
        await service.setMode('blacklist', 'bl-1', null);
        expect(service.getSnapshot()?.mode).toBe('blacklist');

        // If store throws on next read, old snapshot is retained
        (store.getAccessPolicySnapshot as any).mockRejectedValueOnce(new Error('DB disconnect'));
        const refreshed = await service.refresh();
        expect(refreshed.mode).toBe('blacklist');
        expect(service.getSnapshot()?.mode).toBe('blacklist');
    });
});
