import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../database/database';
import { sql } from 'kysely';
import { Store } from '../database/store';
import type { AppendMessageInput } from '../database/store';

let directory = '';
let database: Database | undefined;
let store: Store;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'napcat-ai-chat-test-'));
    database = await createDatabase({
        driver: 'sqlite', sqliteFile: 'test.sqlite', connectionString: '', poolSize: 1, tls: false,
    }, directory);
    store = new Store(database);
    await store.seed();
});

afterEach(async () => {
    await database?.close();
    database = undefined;
    await fs.rm(directory, { recursive: true, force: true });
});

const input = (conversationId: string, messageId: string): AppendMessageInput => ({
    conversationId, napcatMessageId: messageId, senderId: '10001', senderName: 'Alice', senderKind: 'human',
    role: 'user', content: [{ type: 'text', data: { text: 'hello' } }], rawEvent: { id: messageId }, occurredAt: 1, batch: true,
});

describe('SQLite persistence', () => {
    it('initializes fresh install in whitelist mode with active default lists', async () => {
        const state = await store.getAccessControlState();
        expect(state.mode).toBe('whitelist');
        expect(state.activeBlacklistId).not.toBeNull();
        expect(state.activeWhitelistId).not.toBeNull();
        const defaultWl = await store.getAccessList(state.activeWhitelistId!);
        expect(defaultWl?.name).toBe('默认白名单');
        expect(defaultWl?.isDefault).toBe(true);
        const defaultBl = await store.getAccessList(state.activeBlacklistId!);
        expect(defaultBl?.name).toBe('默认黑名单');
        expect(defaultBl?.isDefault).toBe(true);
    });

    it('prevents deletion of default access lists', async () => {
        const state = await store.getAccessControlState();
        await expect(store.deleteAccessList(state.activeWhitelistId!)).rejects.toThrow('默认名单不可删除');
        await expect(store.deleteAccessList(state.activeBlacklistId!)).rejects.toThrow('默认名单不可删除');
    });

    it('allocates gap-free conversation sequences and deduplicates NapCat events', async () => {
        await store.setAccessControlState({ mode: 'blacklist' });
        const conversation = await store.ensureConversation('group', '20001');
        const first = await store.appendMessage(input(conversation.id, 'n1'));
        const second = await store.appendMessage(input(conversation.id, 'n2'));
        const duplicate = await store.appendMessage(input(conversation.id, 'n2'));
        expect(first.message.seq).toBe(1);
        expect(second.message.seq).toBe(2);
        expect(second.batch?.id).toBe(first.batch?.id);
        expect(duplicate.duplicate).toBe(true);
        expect((await store.getBatchMessages(first.batch!.id)).map((message) => message.seq)).toEqual([1, 2]);
    });

    it('filters blacklisted senders from model history while preserving owner-visible raw data', async () => {
        await store.setAccessControlState({ mode: 'blacklist' });
        const conversation = await store.ensureConversation('group', '20001');
        const first = await store.appendMessage(input(conversation.id, 'n1'));
        await store.appendMessage({ ...input(conversation.id, 'n2'), senderId: '10002' });
        await store.saveSummary(conversation.id, 'contains old content', 0, 2);
        await store.addBlacklist('user', '10001');
        expect((await store.getBatchMessages(first.batch!.id)).map((message) => message.senderId)).toEqual(['10002']);
        expect((await store.getRecentMessages(conversation.id, 3, 10, false)).map((message) => message.senderId)).toEqual(['10001', '10002']);
        expect((await store.getSummary(conversation.id)).coveredThroughSeq).toBe(0);
    });

    it('filters unwhitelisted conversations in whitelist mode while keeping raw data accessible', async () => {
        const conversation = await store.ensureConversation('group', '20001');
        const first = await store.appendMessage(input(conversation.id, 'n1'));

        // Whitelist mode with no active whitelist -> denied to model, raw data still readable
        expect(await store.getBatchMessages(first.batch!.id)).toEqual([]);
        expect(await store.getRecentMessages(conversation.id, 2, 10, true)).toEqual([]);
        expect((await store.getRecentMessages(conversation.id, 2, 10, false)).length).toBe(1);

        // Add to whitelist
        const list = await store.createAccessList('whitelist', '班级群白名单');
        await store.addAccessListMembers(list.id, [{ subjectType: 'group', subjectId: '20001' }]);
        await store.setAccessControlState({ mode: 'whitelist', activeWhitelistId: list.id });

        // Now whitelisted group is accessible to model
        expect((await store.getBatchMessages(first.batch!.id)).length).toBe(1);
        expect((await store.getRecentMessages(conversation.id, 2, 10, true)).length).toBe(1);
    });

    it('groups memories by user with nicknames and searches across content and names', async () => {
        const conversation = await store.ensureConversation('private', '10001');
        await store.appendMessage(input(conversation.id, 'n1'));
        await store.saveMemories([
            { qq: '10001', scope: 'private', content: '喜欢喝奶茶', importance: 3, confidence: 90, sourceConversationId: conversation.id, sourceMessageId: 'm1' },
            { qq: '10001', scope: 'group', content: '住在深圳', importance: 4, confidence: 95, sourceConversationId: conversation.id, sourceMessageId: 'm2' },
            { qq: '10002', scope: 'group', content: '养了一只猫', importance: 3, confidence: 80, sourceConversationId: conversation.id, sourceMessageId: 'm3' },
        ]);
        const ids = await store.listMemories('', '10001');
        expect(ids).toHaveLength(2);
        await store.updateMemory(ids[0].id, { valid: false });

        const users = await store.listMemoryUsers();
        expect(users).toHaveLength(2);
        const alice = users.find((user) => user.qq === '10001')!;
        expect(alice.displayName).toBe('Alice');
        expect(alice.total).toBe(2);
        expect(alice.active).toBe(1);
        expect(alice.privateCount).toBe(1);
        expect(alice.groupCount).toBe(1);
        expect(alice.lastUpdatedAt).toBeGreaterThan(0);
        expect(users.find((user) => user.qq === '10002')!.displayName).toBe('');

        await store.setProfileAddress('10001', 'Alice同学', true);
        const addressed = (await store.listMemoryUsers()).find((user) => user.qq === '10001')!;
        expect(addressed.address).toBe('Alice同学');
        expect(addressed.addressManual).toBe(true);
        expect((await store.getProfiles(['10001']))[0].address).toBe('Alice同学');

        expect((await store.listMemoryUsers('Alice')).map((user) => user.qq)).toEqual(['10001']);
        expect((await store.listMemoryUsers('猫')).map((user) => user.qq)).toEqual(['10002']);
        expect(await store.listMemoryUsers('不存在')).toEqual([]);
    });

    it('upgrades a v3 schema by adding address columns without losing profiles', async () => {
        await store.ensureConversation('private', '10001');
        await store.appendMessage(input((await store.ensureConversation('private', '10001')).id, 'n1'));
        await sql`alter table user_profiles drop column address`.execute(database!.db);
        await sql`alter table user_profiles drop column address_manual`.execute(database!.db);
        await database!.setMetadata('schema_version', '3');
        await database!.migrate();
        expect(await database!.getMetadata('schema_version')).toBe('4');
        const profiles = await store.getProfiles(['10001']);
        expect(profiles[0].displayName).toBe('Alice');
        expect(profiles[0].address).toBe('');
        await store.setProfileAddress('10001', 'Alice同学', true);
        expect((await store.getProfiles(['10001']))[0].address).toBe('Alice同学');
    });

    it('keeps immutable raw messages when saving a summary', async () => {
        await store.setAccessControlState({ mode: 'blacklist' });
        const conversation = await store.ensureConversation('private', '10001');
        await store.appendMessage(input(conversation.id, 'n1'));
        expect(await store.saveSummary(conversation.id, 'summary', 0, 1)).toBe(true);
        expect((await store.getRecentMessages(conversation.id, 2, 10))[0].rawEvent).toEqual({ id: 'n1' });
        expect(await store.saveSummary(conversation.id, 'lost update', 0, 1)).toBe(false);
    });
});
