import type { ChatMessage, ImageAnnotation } from '../../types';
import { ParticipantAliases } from '../chat/participants';

export interface TranscriptOptions {
    timezone?: string;
    previousOccurredAt?: number;
    images?: ImageAnnotation[];
    now?: number;
}

const GAP_THRESHOLD_MS = 15 * 60 * 1000;

function partsInZone(timestamp: number, timezone?: string): Record<string, string> {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone || undefined,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    });
    return Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
}

/** 同年只保留 MM-dd HH:mm，跨年补上年份，尽量省 token。 */
export function formatMessageTime(timestamp: number, timezone?: string, now = Date.now()): string {
    const parts = partsInZone(timestamp, timezone);
    const current = partsInZone(now, timezone);
    const day = `${parts.month}-${parts.day}`;
    const clock = `${parts.hour}:${parts.minute}`;
    return parts.year === current.year ? `${day} ${clock}` : `${parts.year}-${day} ${clock}`;
}

export function formatCurrentTime(timezone?: string, now = Date.now()): string {
    const parts = partsInZone(now, timezone);
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.weekday}`;
}

export function formatGap(durationMs: number): string {
    const minutes = Math.round(durationMs / 60000);
    if (minutes < 60) return `间隔 ${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const rest = minutes % 60;
        return rest ? `间隔 ${hours} 小时 ${rest} 分` : `间隔 ${hours} 小时`;
    }
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `间隔 ${days} 天 ${restHours} 小时` : `间隔 ${days} 天`;
}

export function transcript(messages: ChatMessage[], aliases: ParticipantAliases, options: TranscriptOptions = {}): string {
    const imageRefs = new Map((options.images ?? []).map((image) => [`${image.messageId}:${image.segmentIndex}`, image]));
    let previous = options.previousOccurredAt;
    const now = options.now ?? Date.now();
    return JSON.stringify(messages.map((message) => {
        const gap = previous !== undefined && message.occurredAt - previous > GAP_THRESHOLD_MS
            ? formatGap(message.occurredAt - previous)
            : null;
        previous = message.occurredAt;
        return {
            seq: message.seq,
            messageId: message.napcatMessageId ?? undefined,
            time: formatMessageTime(message.occurredAt, options.timezone, now),
            ...(gap ? { gap } : {}),
            role: message.role,
            participant: message.senderKind === 'self' ? 'assistant' : aliases.alias(message.senderId) ?? 'unknown',
            name: message.senderKind === 'self' ? 'assistant' : message.senderName,
            kind: message.senderKind,
            content: message.content.map((segment, segmentIndex) => {
                if (segment.type === 'text') return { type: 'text', text: String(segment.data.text ?? '') };
                if (segment.type === 'at') return { type: 'mention', participant: segment.data.participant ?? '[提及]' };
                if (segment.type === 'image' || segment.type === 'mface') {
                    const image = imageRefs.get(`${message.id}:${segmentIndex}`);
                    const summary = image?.summary || String(segment.data.summary ?? '[图片]');
                    return {
                        type: segment.type,
                        ...(image ? { ref: image.ref } : {}),
                        summary,
                        ...(image?.known ? { collected: true } : {}),
                    };
                }
                if (segment.type === 'reply') return { type: 'reply', id: String(segment.data.id ?? '') };
                return { type: segment.type };
            }),
        };
    }));
}

export function estimateTextTokens(value: string): number {
    let units = 0;
    for (const char of value) units += char.charCodeAt(0) > 255 ? 1 : 0.3;
    return Math.ceil(units + value.length / 32);
}
