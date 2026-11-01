import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCurrentTime, formatGap, formatMessageTime, transcript } from '../services/context/format';
import { ContextComposer } from '../services/context/context-composer';
import { ParticipantAliases } from '../services/chat/participants';
import { pluginState } from '../core/state';
import { createDefaultConfig } from '../config';
import type { Store } from '../database/store';
import type { ChatMessage, Conversation, ProviderProfile } from '../types';

const base = Date.UTC(2026, 10, 1, 0, 5); // 2026-11-01 08:05 in Asia/Shanghai
const conversation: Conversation = {
    id: 'c1', type: 'private', targetId: '10001', title: 'test', nextSeq: 3, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};
const message = (patch: Partial<ChatMessage>): ChatMessage => ({
    id: 'm1', conversationId: 'c1', seq: 1, batchId: 'b1', napcatMessageId: 'n1',
    senderId: '10001', senderName: 'Alice', senderKind: 'human', role: 'user',
    content: [{ type: 'text', data: { text: '晚安' } }], rawEvent: {}, occurredAt: base, receivedAt: base, ...patch,
});
const profile: ProviderProfile = {
    id: 'p1', name: 'Main', type: 'google', model: 'm', apiKey: 'k', contextWindow: 100000,
    maxOutputTokens: 1000, temperature: 0.7, vision: true, toolCalling: true, structuredOutput: true,
};

beforeEach(() => { pluginState.config = createDefaultConfig(); });

describe('message time formatting', () => {
    it('formats message time in the configured timezone', () => {
        expect(formatMessageTime(base, 'Asia/Shanghai', base)).toBe('11-01 08:05');
        expect(formatMessageTime(base, 'UTC', base)).toBe('11-01 00:05');
        expect(formatCurrentTime('Asia/Shanghai', base)).toContain('2026-11-01 08:05');
    });

    it('prefixes the year only when it differs from the current year', () => {
        const older = Date.UTC(2024, 0, 2, 3, 4);
        expect(formatMessageTime(older, 'Asia/Shanghai', base)).toBe('2024-01-02 11:04');
    });

    it('describes gaps in minutes, hours and days', () => {
        expect(formatGap(20 * 60000)).toBe('间隔 20 分钟');
        expect(formatGap(8 * 3600000)).toBe('间隔 8 小时');
        expect(formatGap(200 * 60000)).toBe('间隔 3 小时 20 分');
        expect(formatGap(26 * 3600000)).toBe('间隔 1 天 2 小时');
    });

    it('marks long silences and image references in the transcript', () => {
        const night = message({ id: 'night', seq: 1, occurredAt: base });
        const morning = message({
            id: 'morning', seq: 2, occurredAt: base + 8 * 3600000,
            content: [{ type: 'image', data: { summary: '[图片]' } }],
        });
        const aliases = new ParticipantAliases([night, morning]);
        const output = JSON.parse(transcript([night, morning], aliases, {
            timezone: 'Asia/Shanghai',
            now: base + 8 * 3600000,
            images: [{ messageId: 'morning', segmentIndex: 0, seq: 2, ref: 'img1', summary: '猫咪呔！', known: true }],
        }));
        expect(output[0].time).toBe('11-01 08:05');
        expect(output[0].gap).toBeUndefined();
        expect(output[1].gap).toBe('间隔 8 小时');
        expect(output[1].content[0]).toMatchObject({ ref: 'img1', summary: '猫咪呔！', collected: true });
    });
});

describe('composer image binding', () => {
    it('places each image right after its owning seq label and adds current time to the system prompt', async () => {
        const store = {
            getPrompt: vi.fn().mockResolvedValue(null),
            getSummary: vi.fn().mockResolvedValue({ content: '', coveredThroughSeq: 0 }),
            getRecentMessages: vi.fn().mockResolvedValue([]),
            getProfiles: vi.fn().mockResolvedValue([]),
        } as unknown as Store;
        const memories = { relevant: vi.fn().mockResolvedValue([]) };
        const composer = new ContextComposer(store, memories as never, {} as never);
        const current = [message({ id: 'm-img', seq: 7, content: [{ type: 'image', data: {} }] })];
        const composed = await composer.compose(
            conversation, current, new ParticipantAliases(current), profile,
            {
                parts: [{ type: 'image', mime: 'image/png', data: 'aGVsbG8=' }],
                annotations: [{ messageId: 'm-img', segmentIndex: 0, seq: 7, ref: 'img1', summary: '[图片]', known: false }],
            },
        );
        const content = composed.messages[1].content;
        expect(content[1]).toEqual({ type: 'text', text: '【img1 属于 seq 7】' });
        expect(content[2]).toEqual({ type: 'image', mime: 'image/png', data: 'aGVsbG8=' });
        expect(JSON.stringify(content[0])).toContain('img1');
        expect(composed.messages[0].content[0]).toMatchObject({ type: 'text' });
        const system = String((composed.messages[0].content[0] as { text: string }).text);
        expect(system).toContain('当前时间：');
        expect(system).toContain('不要逐张描述');
    });
});
