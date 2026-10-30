import type { ConversationType, MessageSegment, SenderKind } from '../types';
import { pluginState } from '../core/state';

export interface NormalizedIncoming {
    type: ConversationType;
    targetId: string;
    title: string;
    userId: string;
    senderName: string;
    senderKind: SenderKind;
    messageId: string | null;
    segments: MessageSegment[];
    rawEvent: unknown;
    occurredAt: number;
    mentionedBot: boolean;
    repliedMessageId: string | null;
}

export function normalizeMessage(event: any): NormalizedIncoming | null {
    if (!event || event.post_type !== 'message') return null;
    const type = event.message_type === 'group' ? 'group' : event.message_type === 'private' ? 'private' : null;
    if (!type) return null;
    const userId = String(event.user_id ?? event.sender?.user_id ?? '');
    const groupId = String(event.group_id ?? '');
    if (!userId || (type === 'group' && !groupId)) return null;
    const senderName = String(event.sender?.card || event.sender?.nickname || '参与者');
    const self = Boolean(pluginState.selfId) && userId === pluginState.selfId;
    const bot = Boolean(event.sender?.is_robot ?? event.is_robot ?? false);
    const segments = normalizeSegments(event.message, event.raw_message);
    const mentionedByAt = segments.some((segment) => segment.type === 'at' && String(segment.data.qq ?? '') === pluginState.selfId);
    const raw = String(event.raw_message ?? '');
    const mentionedByName = Boolean(pluginState.selfName) && raw.toLocaleLowerCase().includes(pluginState.selfName.toLocaleLowerCase());
    const reply = segments.find((segment) => segment.type === 'reply');
    return {
        type,
        targetId: type === 'group' ? groupId : userId,
        title: type === 'group' ? String(event.group_name ?? groupId) : senderName,
        userId,
        senderName,
        senderKind: self ? 'self' : bot ? 'bot' : 'human',
        messageId: event.message_id == null ? null : String(event.message_id),
        segments,
        rawEvent: event,
        occurredAt: Number(event.time ?? Math.floor(Date.now() / 1000)) * (Number(event.time ?? 0) < 100000000000 ? 1000 : 1),
        mentionedBot: mentionedByAt || mentionedByName,
        repliedMessageId: reply?.data.id == null ? null : String(reply.data.id),
    };
}

export function normalizeSegments(message: unknown, rawMessage: unknown): MessageSegment[] {
    if (Array.isArray(message)) {
        return message.filter((segment) => segment && typeof segment.type === 'string').map((segment) => ({
            type: String(segment.type),
            data: typeof segment.data === 'object' && segment.data !== null ? segment.data : {},
        }));
    }
    if (message && typeof message === 'object' && 'type' in message) {
        const segment = message as MessageSegment;
        return [{ type: segment.type, data: segment.data ?? {} }];
    }
    const text = typeof message === 'string' ? message : typeof rawMessage === 'string' ? rawMessage : '';
    return text ? [{ type: 'text', data: { text } }] : [];
}

export const textSegment = (text: string): MessageSegment => ({ type: 'text', data: { text } });
export const atSegment = (qq: string): MessageSegment => ({ type: 'at', data: { qq } });
export const imageSegment = (file: string): MessageSegment => ({ type: 'image', data: { file } });
export const replySegment = (id: string): MessageSegment => ({ type: 'reply', data: { id } });
