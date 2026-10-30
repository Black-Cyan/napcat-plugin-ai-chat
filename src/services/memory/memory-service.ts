import { Store } from '../../database/store';
import type { ChatMessage, Conversation, MemoryScope, UserMemory } from '../../types';
import { ParticipantAliases } from '../chat/participants';
import { AITasks } from '../ai/tasks';
import { runtimeLogs } from '../../core/log-buffer';

export class MemoryService {
    constructor(private readonly store: Store, private readonly tasks: AITasks) {}

    async relevant(conversation: Conversation, messages: ChatMessage[], aliases: ParticipantAliases): Promise<UserMemory[]> {
        const scopes = conversation.type === 'private' ? ['private', 'group'] as const : ['group'] as const;
        const memories = await this.store.findMemories(aliases.ids(), [...scopes]);
        const transcript = messages.map((message) => message.content.map((part) => String(part.data.text ?? '')).join('')).join('\n').toLocaleLowerCase();
        return memories.map((memory) => {
            let score = memory.importance * 8 + memory.confidence / 20 + Math.min(memory.useCount, 10);
            if (transcript && transcript.includes(memory.content.toLocaleLowerCase())) score += 40;
            score += Math.max(0, 10 - (Date.now() - memory.updatedAt) / 86400000);
            return { memory, score };
        }).sort((a, b) => b.score - a.score).slice(0, 12).map((item) => item.memory);
    }

    async updateFromBatch(conversation: Conversation, messages: ChatMessage[], aliases: ParticipantAliases): Promise<void> {
        const candidates = messages.filter((message) => message.senderKind !== 'self' && message.senderId);
        if (!candidates.length) return;
        const scopes: MemoryScope[] = conversation.type === 'private' ? ['private', 'group'] : ['group'];
        const existing = await this.store.findMemories(aliases.ids(), scopes);
        const transcript = candidates.map((message) => ({
            participant: aliases.alias(message.senderId),
            name: message.senderName,
            kind: message.senderKind,
            text: message.content.map((part) => String(part.data.text ?? '')).join(''),
        }));
        const extracted = await this.tasks.extractMemories(
            JSON.stringify(transcript),
            existing.map((memory) => ({ id: memory.id, participant: aliases.alias(memory.qq), content: memory.content })),
            conversation,
        );
        const allowedExisting = new Set(existing.map((memory) => memory.id));
        for (const candidate of extracted) {
            let qq = aliases.id(candidate.participant);
            if (!qq) {
                const byName = aliases.entries().find((entry) =>
                    entry.name.toLocaleLowerCase() === candidate.participant.toLocaleLowerCase()
                    || entry.alias.toLocaleLowerCase() === candidate.participant.toLocaleLowerCase()
                );
                if (byName) qq = byName.id;
            }
            if (!qq && /^\d{5,12}$/.test(candidate.participant.trim())) {
                qq = candidate.participant.trim();
            }
            if (!qq && aliases.ids().length === 1) {
                qq = aliases.ids()[0];
            }
            if (!qq || !candidate.content.trim()) continue;
            const duplicate = existing.some((memory) => memory.qq === qq && memory.scope === conversation.type && normalize(memory.content) === normalize(candidate.content));
            if (duplicate) continue;
            const source = candidates.find((message) => message.senderId === qq) ?? candidates[0];
            const saved = await this.store.saveMemories([{
                qq,
                scope: conversation.type,
                content: candidate.content,
                importance: candidate.importance,
                confidence: candidate.confidence,
                sourceConversationId: conversation.id,
                sourceMessageId: source.id,
            }]);
            if (candidate.supersedes && allowedExisting.has(candidate.supersedes)) {
                const previous = existing.find((memory) => memory.id === candidate.supersedes);
                if (previous?.qq === qq) await this.store.supersedeMemory(candidate.supersedes, saved[0]);
            }
            runtimeLogs.add('info', `提炼用户记忆 [QQ ${qq}]: ${candidate.content.slice(0, 50)}`, 'system', {
                qq,
                scope: conversation.type,
                content: candidate.content,
                importance: candidate.importance,
                confidence: candidate.confidence,
            });
        }
    }
}

function normalize(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
