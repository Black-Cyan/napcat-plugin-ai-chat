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

export function sanitizeSegmentData(data: Record<string, any>): Record<string, any> {
    const cleaned = { ...data };
    if (typeof cleaned.url === 'string') {
        cleaned.url = cleaned.url.replace(/&amp;/g, '&').trim();
    }
    if (typeof cleaned.file === 'string') {
        cleaned.file = cleaned.file.replace(/&amp;/g, '&').trim();
    }
    return cleaned;
}

export function parseCqCode(text: string): MessageSegment[] {
    if (!text) return [];
    const segments: MessageSegment[] = [];
    const cqPattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[a-zA-Z0-9_-]+=[^,\]]*)*)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = cqPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const before = unescapeCqText(text.slice(lastIndex, match.index));
            if (before) segments.push({ type: 'text', data: { text: before } });
        }
        const type = match[1];
        const paramsStr = match[2];
        const data: Record<string, any> = {};
        if (paramsStr) {
            const parts = paramsStr.slice(1).split(',');
            for (const part of parts) {
                const eqIdx = part.indexOf('=');
                if (eqIdx !== -1) {
                    const k = part.slice(0, eqIdx).trim();
                    const v = unescapeCqValue(part.slice(eqIdx + 1));
                    data[k] = v;
                }
            }
        }
        segments.push({ type, data: sanitizeSegmentData(data) });
        lastIndex = cqPattern.lastIndex;
    }

    if (lastIndex < text.length) {
        const rest = unescapeCqText(text.slice(lastIndex));
        if (rest) segments.push({ type: 'text', data: { text: rest } });
    }

    return segments.length > 0 ? segments : [{ type: 'text', data: { text } }];
}

function unescapeCqText(text: string): string {
    return text
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&amp;/g, '&');
}

function unescapeCqValue(val: string): string {
    return val
        .replace(/&#44;/g, ',')
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&amp;/g, '&');
}

export function normalizeSegments(message: unknown, rawMessage: unknown): MessageSegment[] {
    if (Array.isArray(message)) {
        return message.filter((segment) => segment && typeof segment.type === 'string').map((segment) => ({
            type: String(segment.type),
            data: sanitizeSegmentData(typeof segment.data === 'object' && segment.data !== null ? segment.data : {}),
        }));
    }
    if (message && typeof message === 'object' && 'type' in message) {
        const segment = message as MessageSegment;
        return [{ type: segment.type, data: sanitizeSegmentData(segment.data ?? {}) }];
    }
    const text = typeof message === 'string' ? message : typeof rawMessage === 'string' ? rawMessage : '';
    if (!text) return [];
    if (text.includes('[CQ:')) {
        return parseCqCode(text);
    }
    return [{ type: 'text', data: { text } }];
}

export const textSegment = (text: string): MessageSegment => ({ type: 'text', data: { text } });
export const atSegment = (qq: string): MessageSegment => ({ type: 'at', data: { qq } });
export const imageSegment = (file: string, subType = 0, summary?: string): MessageSegment => ({
    type: 'image',
    data: {
        file,
        ...(subType ? { sub_type: subType } : {}),
        ...(summary ? { summary } : {}),
    },
});
export const stickerSegment = (file: string, summary = '[动画表情]'): MessageSegment => ({
    type: 'image',
    data: { file, sub_type: 7, summary },
});
export const replySegment = (id: string): MessageSegment => ({ type: 'reply', data: { id } });
