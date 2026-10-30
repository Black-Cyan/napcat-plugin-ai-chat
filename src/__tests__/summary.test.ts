import { describe, expect, it, vi } from 'vitest';
import { SummaryService } from '../services/context/summary-service';
import type { Store } from '../database/store';
import type { AITasks } from '../services/ai/tasks';
import type { Conversation } from '../types';

const conversation: Conversation = {
    id: 'c1', type: 'group', targetId: 'g1', title: 'g1', nextSeq: 20, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};

describe('SummaryService', () => {
    it('does not advance the summary watermark when summarization fails', async () => {
        const saveSummary = vi.fn();
        const store = {
            getSummary: vi.fn().mockResolvedValue({ content: 'old', coveredThroughSeq: 0 }),
            getMessagesThrough: vi.fn().mockResolvedValue([{
                id: 'm1', conversationId: 'c1', seq: 1, batchId: null, napcatMessageId: null,
                senderId: 'u1', senderName: 'u1', senderKind: 'human', role: 'user', content: [], rawEvent: {}, occurredAt: 1, receivedAt: 1,
            }, {
                id: 'm2', conversationId: 'c1', seq: 2, batchId: null, napcatMessageId: null,
                senderId: 'u1', senderName: 'u1', senderKind: 'human', role: 'user', content: [], rawEvent: {}, occurredAt: 1, receivedAt: 1,
            }, {
                id: 'm3', conversationId: 'c1', seq: 3, batchId: null, napcatMessageId: null,
                senderId: 'u1', senderName: 'u1', senderKind: 'human', role: 'user', content: [], rawEvent: {}, occurredAt: 1, receivedAt: 1,
            }, {
                id: 'm4', conversationId: 'c1', seq: 4, batchId: null, napcatMessageId: null,
                senderId: 'u1', senderName: 'u1', senderKind: 'human', role: 'user', content: [], rawEvent: {}, occurredAt: 1, receivedAt: 1,
            }]),
            saveSummary,
        } as unknown as Store;
        const tasks = { summarize: vi.fn().mockRejectedValue(new Error('provider unavailable')) } as unknown as AITasks;
        const service = new SummaryService(store, tasks);
        await expect(service.compressOlder(conversation, 20)).rejects.toThrow('provider unavailable');
        expect(saveSummary).not.toHaveBeenCalled();
    });
});
