import { describe, expect, it, vi } from 'vitest';
import { BlacklistService } from '../services/security/blacklist-service';
import type { Store } from '../database/store';

function storeMock() {
    return {
        listBlacklist: vi.fn().mockResolvedValue([{ type: 'user', id: '10001', createdAt: 1 }, { type: 'group', id: '20001', createdAt: 1 }]),
        addBlacklist: vi.fn().mockResolvedValue(undefined),
        removeBlacklist: vi.fn().mockResolvedValue(undefined),
    } as unknown as Store;
}

describe('BlacklistService', () => {
    it('blocks blacklisted users and groups before any message processing', async () => {
        const store = storeMock();
        const blacklist = new BlacklistService(store);
        await blacklist.init();
        expect(blacklist.allowed('10001')).toBe(false);
        expect(blacklist.allowed('10002', '20001')).toBe(false);
        expect(blacklist.allowed('10002', '20002')).toBe(true);
        await blacklist.add('user', '10003');
        expect(blacklist.allowed('10003')).toBe(false);
        await blacklist.remove('user', '10003');
        expect(blacklist.allowed('10003')).toBe(true);
    });
});
