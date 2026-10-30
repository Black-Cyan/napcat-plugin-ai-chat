import { describe, expect, it, vi } from 'vitest';
import { getFriendList, getGroupList } from '../napcat/actions';
import type { NapCatPluginContext } from '../napcat/plugin-types';

describe('NapCat contact actions', () => {
    it('strips phone, email, and sensitive info from friend list', async () => {
        const mockCall = vi.fn().mockResolvedValue([
            {
                user_id: 123456,
                nickname: '好友张三',
                remark: '小张',
                phone_num: '13800000000',
                email: 'secret@example.com',
                birthday_year: 1990,
                birthday_month: 1,
                birthday_day: 1,
            },
            {
                user_id: '00789',
                nickname: '带前导零好友',
            },
        ]);

        const ctx = {
            actions: { call: mockCall },
            adapterName: 'test',
            pluginManager: { config: {} },
        } as unknown as NapCatPluginContext;

        const friends = await getFriendList(ctx, false);
        expect(friends).toEqual([
            { id: '123456', name: '好友张三', type: 'user', remark: '小张' },
            { id: '789', name: '带前导零好友', type: 'user', remark: undefined },
        ]);
        expect((friends[0] as any).phone_num).toBeUndefined();
        expect((friends[0] as any).email).toBeUndefined();
        expect((friends[0] as any).birthday_year).toBeUndefined();
    });

    it('extracts essential group info and normalizes IDs', async () => {
        const mockCall = vi.fn().mockResolvedValue([
            {
                group_id: 20001,
                group_name: '测试大群',
                group_remark: '群备注',
                group_all_shut: 0,
                member_count: 50,
                max_member_count: 500,
            },
            {
                group_id: '0050005',
                group_name: '数字零群',
            },
        ]);

        const ctx = {
            actions: { call: mockCall },
            adapterName: 'test',
            pluginManager: { config: {} },
        } as unknown as NapCatPluginContext;

        const groups = await getGroupList(ctx, true);
        expect(groups).toEqual([
            { id: '20001', name: '测试大群', type: 'group', remark: '群备注', memberCount: 50 },
            { id: '50005', name: '数字零群', type: 'group', remark: undefined, memberCount: undefined },
        ]);
    });
});
