import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from '../services/memory/memory-service';
import type { Store } from '../database/store';
import type { AITasks } from '../services/ai/tasks';
import type { ChatMessage, Conversation } from '../types';
import { ParticipantAliases } from '../services/chat/participants';

const conversation = (type: 'private' | 'group'): Conversation => ({
    id: 'c1', type, targetId: 'target', title: 'test', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
});
const message = (): ChatMessage => ({
    id: 'm1', conversationId: 'c1', seq: 1, batchId: 'b1', napcatMessageId: 'n1', senderId: '10001',
    senderName: 'Alice', senderKind: 'human', role: 'user', content: [{ type: 'text', data: { text: 'hello' } }],
    rawEvent: {}, occurredAt: 1, receivedAt: 1,
});

describe('memory visibility', () => {
    it.each([
        ['group', ['group']],
        ['private', ['private', 'group']],
    ] as const)('only queries permitted scopes for %s conversations', async (type, expected) => {
        const findMemories = vi.fn().mockResolvedValue([]);
        const store = { findMemories } as unknown as Store;
        const service = new MemoryService(store, {} as AITasks);
        const messages = [message()];
        await service.relevant(conversation(type), messages, new ParticipantAliases(messages));
        expect(findMemories).toHaveBeenCalledWith(['10001'], expected);
    });
});
