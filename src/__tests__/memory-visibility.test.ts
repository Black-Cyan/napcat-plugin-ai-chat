import { describe, expect, it, vi } from 'vitest';
import { MemoryService } from '../services/memory/memory-service';
import type { Store } from '../database/store';
import type { AITasks } from '../services/ai/tasks';
import { memoryResultSchema } from '../services/ai/tasks';
import type { ChatMessage, Conversation } from '../types';
import { ParticipantAliases } from '../services/chat/participants';

const conversation = (type: 'private' | 'group'): Conversation => ({
    id: 'c1', type, targetId: 'target', title: 'test', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
});
const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'm1', conversationId: 'c1', seq: 1, batchId: 'b1', napcatMessageId: 'n1', senderId: '10001',
    senderName: 'Alice', senderKind: 'human', role: 'user', content: [{ type: 'text', data: { text: 'hello' } }],
    rawEvent: {}, occurredAt: 1, receivedAt: 1, ...patch,
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

    it('transforms float importance and confidence into integer bounds', () => {
        const raw = {
            memories: [
                { participant: 'p1', content: '爱好羽毛球', importance: 0.8, confidence: 0.95 },
                { participant: 'p1', content: '在深圳工作', importance: 4, confidence: 90 },
            ],
        };
        const parsed = memoryResultSchema.parse(raw);
        expect(parsed.memories[0].importance).toBe(4);
        expect(parsed.memories[0].confidence).toBe(95);
        expect(parsed.memories[1].importance).toBe(4);
        expect(parsed.memories[1].confidence).toBe(90);
    });

    it('resolves participant by nickname or fallback when LLM outputs nickname', async () => {
        const saveMemories = vi.fn().mockResolvedValue([{ id: 'saved-1' }]);
        const store = {
            findMemories: vi.fn().mockResolvedValue([]),
            saveMemories,
        } as unknown as Store;

        const tasks = {
            extractMemories: vi.fn().mockResolvedValue([
                { participant: 'Alice', content: '喜欢喝奶茶', importance: 3, confidence: 80 },
            ]),
        } as unknown as AITasks;

        const service = new MemoryService(store, tasks);
        const messages = [message({ senderId: '10001', senderName: 'Alice' })];
        await service.updateFromBatch(conversation('group'), messages, new ParticipantAliases(messages));

        expect(saveMemories).toHaveBeenCalledWith([
            expect.objectContaining({
                qq: '10001',
                scope: 'group',
                content: '喜欢喝奶茶',
                importance: 3,
                confidence: 80,
            }),
        ]);
    });
});
