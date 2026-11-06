import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../database/database';
import { Store } from '../database/store';
import { SocialService } from '../services/social/social-service';
import { pluginState } from '../core/state';
import { createDefaultConfig } from '../config';
import type { ChatMessage, Conversation } from '../types';
import { ParticipantAliases } from '../services/chat/participants';

let directory = '';
let database: Database | undefined;
let store: Store;

const conversation: Conversation = {
    id: 'c1', type: 'group', targetId: '574551365', title: 'Furminal', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};

const makeMessage = (senderId: string, text: string, seq = 1, batchId = 'batch-1'): ChatMessage => ({
    id: `m-${seq}`, conversationId: 'c1', seq, batchId, napcatMessageId: `n-${seq}`,
    senderId, senderName: `User-${senderId}`, senderKind: 'human', role: 'user',
    content: [{ type: 'text', data: { text } }], rawEvent: {}, occurredAt: Date.now(), receivedAt: Date.now(),
});

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'social-engine-test-'));
    database = await createDatabase({
        driver: 'sqlite', sqliteFile: 'test.sqlite', connectionString: '', poolSize: 1, tls: false,
    }, directory);
    store = new Store(database);
    await store.seed();

    pluginState.config = createDefaultConfig();
    pluginState.selfId = 'bot-self';
});

afterEach(async () => {
    await database?.close();
    database = undefined;
    await fs.rm(directory, { recursive: true, force: true });
});

describe('SocialService rules & risk control (Phase 2)', () => {
    it('does nothing when social system is disabled in config', async () => {
        pluginState.config.social.enabled = false;
        const service = new SocialService(store, {} as any);
        const messages = [makeMessage('10001', 'hello')];
        await service.processBatch(conversation, messages, new ParticipantAliases(messages));

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const relation = await store.getSocialRelation('bot-self', internalId);
        expect(relation).toBeNull();
    });

    it('accrues 1 exp on regular chat interaction when enabled and respects 30s cooldown', async () => {
        pluginState.config.social.enabled = true;
        pluginState.config.social.cooldownSeconds = 30;
        const service = new SocialService(store, {} as any);

        const msg1 = [makeMessage('10001', '今天天气不错', 1, 'b1')];
        await service.processBatch(conversation, msg1, new ParticipantAliases(msg1));

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const relation1 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(relation1.familiarityExp).toBe(1);

        // Immediate subsequent message within 30s cooldown should be throttled
        const msg2 = [makeMessage('10001', '吃过饭了吗', 2, 'b2')];
        await service.processBatch(conversation, msg2, new ParticipantAliases(msg2));

        const relation2 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(relation2.familiarityExp).toBe(1); // throttled, still 1
    });

    it('filters out meaningless single-character spam and duplicate content', async () => {
        pluginState.config.social.enabled = true;
        const service = new SocialService(store, {} as any);

        // Single character "1", "哈", or punctuation shouldn't yield exp
        const spam = [makeMessage('10001', '1', 1, 'b1')];
        await service.processBatch(conversation, spam, new ParticipantAliases(spam));

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const relation = await store.getSocialRelation('bot-self', internalId);
        expect(relation).toBeNull();
    });

    it('enforces daily exp cap (maxDailyExp = 20)', async () => {
        pluginState.config.social.enabled = true;
        pluginState.config.social.cooldownSeconds = 0; // disable cooldown for cap test
        pluginState.config.social.maxDailyExp = 5; // low cap for test
        const service = new SocialService(store, {} as any);

        for (let i = 1; i <= 8; i++) {
            const m = [makeMessage('10001', `不同测试发言内容第${i}条`, i, `batch-${i}`)];
            await service.processBatch(conversation, m, new ParticipantAliases(m));
        }

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const relation = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(relation.familiarityExp).toBe(5); // capped at 5
    });

    it('handles multi-speaker batches naturally and records separate events for each user', async () => {
        pluginState.config.social.enabled = true;
        pluginState.config.social.cooldownSeconds = 0;
        const service = new SocialService(store, {} as any);

        const batch = [
            makeMessage('10001', 'Alice发言第一句', 1, 'batch-multi'),
            makeMessage('10002', 'Bob也说了一句', 2, 'batch-multi'),
        ];
        await service.processBatch(conversation, batch, new ParticipantAliases(batch));

        const aliceId = await store.getOrCreateUserIdentity('qq', '10001');
        const bobId = await store.getOrCreateUserIdentity('qq', '10002');

        const aliceRel = await store.getOrCreateSocialRelation('bot-self', aliceId);
        const bobRel = await store.getOrCreateSocialRelation('bot-self', bobId);

        expect(aliceRel.familiarityExp).toBe(1);
        expect(bobRel.familiarityExp).toBe(1);
    });

    it('enforces messageBatchId idempotency on reprocessed batches', async () => {
        pluginState.config.social.enabled = true;
        pluginState.config.social.cooldownSeconds = 0;
        const service = new SocialService(store, {} as any);

        const batch = [makeMessage('10001', '第一次处理批次', 1, 'batch-idempotent-1')];
        await service.processBatch(conversation, batch, new ParticipantAliases(batch));

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const rel1 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(rel1.familiarityExp).toBe(1);

        // Reprocessing the identical batch ID must be completely idempotent
        await service.processBatch(conversation, batch, new ParticipantAliases(batch));
        const rel2 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(rel2.familiarityExp).toBe(1); // not incremented to 2

        const events = await store.listSocialEvents('bot-self', internalId, 10);
        expect(events).toHaveLength(1); // exactly 1 event recorded
    });

    it('enforces daily affection loss cap strictly without overshoot', async () => {
        pluginState.config.social.enabled = true;
        pluginState.config.social.cooldownSeconds = 0;
        pluginState.config.social.enableAiEvaluation = true;
        pluginState.config.social.maxDailyAffectionLoss = 3;

        const fakeTasks = {
            evaluateInteraction: vi.fn().mockResolvedValue({ attitude: 'hostile' }),
        };
        const service = new SocialService(store, fakeTasks as any);

        // Message 1: lossRoom=3, delta = -Math.min(2, 3) = -2
        const m1 = [makeMessage('10001', '充满攻击性的一句话1', 1, 'b-loss-1')];
        await service.processBatch(conversation, m1, new ParticipantAliases(m1));

        const internalId = await store.getOrCreateUserIdentity('qq', '10001');
        const rel1 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(rel1.affection).toBe(-2);

        // Message 2: lossRoom = 3 - 2 = 1. Must deduct exactly 1, not 2!
        const m2 = [makeMessage('10001', '充满攻击性的一句话2', 2, 'b-loss-2')];
        await service.processBatch(conversation, m2, new ParticipantAliases(m2));

        const rel2 = await store.getOrCreateSocialRelation('bot-self', internalId);
        expect(rel2.affection).toBe(-3); // exactly capped at -3, not -4!
    });
});
