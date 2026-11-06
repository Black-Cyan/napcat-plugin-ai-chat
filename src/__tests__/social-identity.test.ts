import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../database/database';
import { Store } from '../database/store';

let directory = '';
let database: Database | undefined;
let store: Store;

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'napcat-social-test-'));
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

describe('social identity & relations repository (Phase 1)', () => {
    it('creates a stable UUID for a platform user and returns the same internal ID on subsequent calls', async () => {
        const id1 = await store.getOrCreateUserIdentity('qq', '10001');
        const id2 = await store.getOrCreateUserIdentity('qq', '10001');
        expect(id1).toBe(id2);
        expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

        const other = await store.getOrCreateUserIdentity('qq', '10002');
        expect(other).not.toBe(id1);

        const found = await store.getIdentityByInternalId(id1);
        expect(found).toMatchObject({
            internalId: id1,
            platform: 'qq',
            externalId: '10001',
        });
    });

    it('initializes default social relation with affection 0 and familiarity Lv1 (0 exp) scoped by botId', async () => {
        const userId = await store.getOrCreateUserIdentity('qq', '10001');
        const relationBotA = await store.getOrCreateSocialRelation('bot-a', userId);
        expect(relationBotA).toMatchObject({
            botId: 'bot-a',
            userId,
            affection: 0,
            familiarityExp: 0,
            familiarityLevel: 1,
        });

        // Multi-bot isolation: Bot B has separate relation for the same user
        const relationBotB = await store.getOrCreateSocialRelation('bot-b', userId);
        expect(relationBotB.botId).toBe('bot-b');
        expect(relationBotB.affection).toBe(0);

        // Adjust Bot A affection and verify Bot B remains unaffected
        await store.applySocialEvent({
            botId: 'bot-a',
            userId,
            eventType: 'admin_adjust',
            affectionDelta: 25,
            expDelta: 60,
            reason: '管理调整',
        });

        const updatedA = await store.getOrCreateSocialRelation('bot-a', userId);
        expect(updatedA.affection).toBe(25);
        expect(updatedA.familiarityExp).toBe(60);

        const unchangedB = await store.getOrCreateSocialRelation('bot-b', userId);
        expect(unchangedB.affection).toBe(0);
        expect(unchangedB.familiarityExp).toBe(0);

        // Verify social_events audit trail was written
        const events = await store.listSocialEvents('bot-a', userId);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            botId: 'bot-a',
            userId,
            eventType: 'admin_adjust',
            affectionDelta: 25,
            affectionAfter: 25,
            expDelta: 60,
            expAfter: 60,
            reason: '管理调整',
        });
    });

    it('resets relation back to 0 affection and Lv1, recording admin_reset event', async () => {
        const userId = await store.getOrCreateUserIdentity('qq', '10001');
        await store.applySocialEvent({
            botId: 'bot-a',
            userId,
            eventType: 'admin_adjust',
            affectionDelta: 50,
            expDelta: 100,
            reason: '测试提升',
        });

        await store.resetSocialRelation('bot-a', userId, '管理员重置');
        const resetRel = await store.getOrCreateSocialRelation('bot-a', userId);
        expect(resetRel.affection).toBe(0);
        expect(resetRel.familiarityExp).toBe(0);
        expect(resetRel.familiarityLevel).toBe(1);

        const events = await store.listSocialEvents('bot-a', userId);
        expect(events[0].eventType).toBe('admin_reset');
        expect(events[0].affectionAfter).toBe(0);
    });
});
