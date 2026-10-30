import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchScheduler } from '../services/chat/batch-scheduler';
import type { Store } from '../database/store';
import type { ChatOrchestrator } from '../services/chat/chat-orchestrator';
import type { Conversation, MessageBatch } from '../types';

const conversation: Conversation = {
    id: 'c1', type: 'group', targetId: 'g1', title: 'g1', nextSeq: 2,
    override: { behavior: { quietMs: 10, maxWaitMs: 1000, maxBatchMessages: 20 } },
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};
const batch: MessageBatch = {
    id: 'b1', conversationId: 'c1', status: 'pending', startSeq: 1, endSeq: 1,
    messageCount: 1, firstMessageAt: Date.now(), lastMessageAt: Date.now(), attempts: 0, error: null,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BatchScheduler', () => {
    it('flushes a quiet batch and preserves per-conversation ordering', async () => {
        const closeBatch = vi.fn().mockResolvedValue(undefined);
        const store = {
            getConversation: vi.fn().mockResolvedValue(conversation), closeBatch,
            recoverProcessingBatches: vi.fn(), listOpenBatches: vi.fn().mockResolvedValue([]),
        } as unknown as Store;
        const process = vi.fn().mockResolvedValue(undefined);
        const scheduler = new BatchScheduler(store, { process, drain: vi.fn().mockResolvedValue(undefined) } as unknown as ChatOrchestrator);
        await scheduler.schedule(batch);
        expect(process).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(11);
        expect(closeBatch).toHaveBeenCalledWith('b1');
        expect(process).toHaveBeenCalledWith('b1');
        await scheduler.close();
    });

    it('flushes immediately at the message count limit', async () => {
        const full = { ...batch, messageCount: 20 };
        const store = {
            getConversation: vi.fn().mockResolvedValue(conversation), closeBatch: vi.fn().mockResolvedValue(undefined),
        } as unknown as Store;
        const process = vi.fn().mockResolvedValue(undefined);
        const scheduler = new BatchScheduler(store, { process, drain: vi.fn().mockResolvedValue(undefined) } as unknown as ChatOrchestrator);
        await scheduler.schedule(full);
        expect(process).toHaveBeenCalledWith('b1');
        await scheduler.close();
    });
});
