import type { ChatMessage } from '../../types';
import { ParticipantAliases } from '../chat/participants';

export function transcript(messages: ChatMessage[], aliases: ParticipantAliases): string {
    return JSON.stringify(messages.map((message) => ({
        seq: message.seq,
        messageId: message.napcatMessageId ?? undefined,
        role: message.role,
        participant: message.senderKind === 'self' ? 'assistant' : aliases.alias(message.senderId) ?? 'unknown',
        name: message.senderKind === 'self' ? 'assistant' : message.senderName,
        kind: message.senderKind,
        content: message.content.map((segment) => {
            if (segment.type === 'text') return { type: 'text', text: String(segment.data.text ?? '') };
            if (segment.type === 'at') return { type: 'mention', participant: segment.data.participant ?? '[提及]' };
            if (segment.type === 'image' || segment.type === 'mface') {
                return { type: segment.type, summary: String(segment.data.summary ?? '[图片]') };
            }
            if (segment.type === 'reply') return { type: 'reply', id: String(segment.data.id ?? '') };
            return { type: segment.type };
        }),
    })));
}

export function estimateTextTokens(value: string): number {
    let units = 0;
    for (const char of value) units += char.charCodeAt(0) > 255 ? 1 : 0.3;
    return Math.ceil(units + value.length / 32);
}
