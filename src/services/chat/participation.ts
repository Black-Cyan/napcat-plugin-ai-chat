import { Store } from '../../database/store';
import type { ChatMessage, Conversation } from '../../types';
import { effectiveBehavior } from './config';
import { normalizeMessage } from '../../napcat/message-segments';

export class ParticipationService {
    private readonly lastReply = new Map<string, number>();

    constructor(private readonly store: Store) {}

    async shouldRespond(conversation: Conversation, messages: ChatMessage[]): Promise<{ respond: boolean; reason: string; botOnly: boolean }> {
        const behavior = effectiveBehavior(conversation);
        const botOnly = messages.length > 0 && messages.every((message) => message.senderKind === 'bot');
        if (botOnly && conversation.botRounds >= behavior.botRoundLimit) {
            await this.store.updateConversation(conversation.id, { botRounds: 0 });
            return { respond: false, reason: 'bot-loop-cooldown', botOnly };
        }
        const counts = new Map<string, number>();
        for (const message of messages) {
            if (message.senderId) counts.set(message.senderId, (counts.get(message.senderId) ?? 0) + 1);
        }
        const burst = Math.max(0, ...counts.values()) > behavior.sameSourceBurstThreshold;
        if (burst && Math.random() > behavior.engagement * 0.8) {
            return { respond: false, reason: 'same-source-cooldown', botOnly };
        }
        if (conversation.type === 'private') return { respond: true, reason: 'private', botOnly };
        const explicitlyMentioned = await this.explicitlyMentioned(conversation, messages);
        if (explicitlyMentioned) return { respond: true, reason: 'mentioned', botOnly };
        if (behavior.engagement <= 0) return { respond: false, reason: 'passive', botOnly };
        const elapsed = Date.now() - (this.lastReply.get(conversation.id) ?? 0);
        if (elapsed < behavior.replyCooldownMs) return { respond: false, reason: 'cooldown', botOnly };
        const text = messages.flatMap((message) => message.content.map((part) => String(part.data.text ?? ''))).join('\n');
        const question = /[?？]|怎么|如何|为什么|有人|大家|觉得/.test(text);
        const ongoing = conversation.updatedAt - messages[0].occurredAt < 120000;
        const score = behavior.engagement * 0.62 + (question ? 0.16 : 0) + (ongoing ? 0.08 : 0) + Math.random() * 0.22;
        return { respond: score >= 0.5, reason: score >= 0.5 ? 'engagement' : 'not-engaged', botOnly };
    }

    async noteOutcome(conversation: Conversation, messages: ChatMessage[], replied: boolean, botOnly: boolean): Promise<void> {
        if (replied) this.lastReply.set(conversation.id, Date.now());
        const hasHuman = messages.some((message) => message.senderKind === 'human');
        const rounds = hasHuman || !replied ? 0 : botOnly ? conversation.botRounds + 1 : 0;
        if (rounds !== conversation.botRounds) await this.store.updateConversation(conversation.id, { botRounds: rounds });
    }

    private async explicitlyMentioned(conversation: Conversation, messages: ChatMessage[]): Promise<boolean> {
        for (const message of messages) {
            if (normalizeMessage(message.rawEvent)?.mentionedBot) return true;
            const reply = message.content.find((segment) => segment.type === 'reply');
            if (reply?.data.id && await this.store.isOwnMessage(conversation.id, String(reply.data.id))) return true;
        }
        return false;
    }
}
