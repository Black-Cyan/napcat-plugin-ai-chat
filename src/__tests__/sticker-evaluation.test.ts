import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StickerService } from '../services/stickers/sticker-service';
import { pluginState } from '../core/state';
import type { Store } from '../database/store';
import type { AITasks } from '../services/ai/tasks';
import type { ChatMessage, Conversation, ProviderProfile } from '../types';

const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const imageSegment = (salt: number) => ({
    type: 'image',
    data: { file: `data:image/png;base64,${Buffer.concat([TINY_PNG, Buffer.from([salt])]).toString('base64')}` },
});
const conversation: Conversation = {
    id: 'c1', type: 'group', targetId: 'g1', title: 'test', nextSeq: 2, override: {},
    promptProfileId: null, providerProfileId: null, botRounds: 0, createdAt: 1, updatedAt: 1,
};
const message = (seq: number, salt: number): ChatMessage => ({
    id: `m${seq}`, conversationId: 'c1', seq, batchId: 'b1', napcatMessageId: `n${seq}`,
    senderId: '10001', senderName: 'Alice', senderKind: 'human', role: 'user',
    content: [imageSegment(salt)], rawEvent: {}, occurredAt: 1, receivedAt: 1,
});

let directory = '';
let store: {
    findSticker: ReturnType<typeof vi.fn>;
    recordSighting: ReturnType<typeof vi.fn>;
    countSightings: ReturnType<typeof vi.fn>;
    saveSticker: ReturnType<typeof vi.fn>;
    getStickerDecision: ReturnType<typeof vi.fn>;
    recordStickerDecision: ReturnType<typeof vi.fn>;
};
let tasks: {
    understandSticker: ReturnType<typeof vi.fn>;
    understandStickerBatch: ReturnType<typeof vi.fn>;
    describeImages: ReturnType<typeof vi.fn>;
    visionProfile: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sticker-eval-'));
    await fs.mkdir(path.join(directory, 'media'), { recursive: true });
    pluginState.setContextForTest({
        dataPath: directory,
        configPath: path.join(directory, 'config.json'),
        adapterName: 'test',
        pluginManager: { config: {} },
        actions: { call: vi.fn().mockResolvedValue({}) },
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    } as never);
    store = {
        findSticker: vi.fn().mockResolvedValue(null),
        recordSighting: vi.fn().mockResolvedValue(undefined),
        countSightings: vi.fn().mockResolvedValue(1),
        saveSticker: vi.fn().mockImplementation(async (input: { sha256: string }) => ({ id: `s-${input.sha256.slice(0, 6)}` })),
        getStickerDecision: vi.fn().mockResolvedValue(null),
        recordStickerDecision: vi.fn().mockResolvedValue(undefined),
    };
    tasks = {
        understandSticker: vi.fn(),
        understandStickerBatch: vi.fn(),
        describeImages: vi.fn(),
        visionProfile: vi.fn().mockReturnValue(null),
    };
});

afterEach(async () => {
    pluginState.setContextForTest(null);
    await fs.rm(directory, { recursive: true, force: true });
});

const service = () => new StickerService(store as unknown as Store, tasks as unknown as AITasks);

describe('sticker evaluation batching', () => {
    it('evaluates all new images of a batch in one vision call and records rejections', async () => {
        tasks.understandStickerBatch.mockResolvedValue([
            { index: 0, summary: '可爱的猫', tags: ['猫'], safe: true, confidence: 0.9, collect: true },
            { index: 1, summary: '普通截图', tags: [], safe: true, confidence: 0.9, collect: false },
            { index: 2, summary: '狗头表情', tags: ['狗'], safe: true, confidence: 0.95, collect: true },
        ]);
        await service().processBatch(conversation, [message(1, 1), message(2, 2), message(3, 3)]);

        expect(tasks.understandStickerBatch).toHaveBeenCalledTimes(1);
        expect(tasks.understandStickerBatch.mock.calls[0][0]).toHaveLength(3);
        expect(store.saveSticker).toHaveBeenCalledTimes(2);
        expect(store.recordStickerDecision).toHaveBeenCalledWith(expect.any(String), 'reject', '普通截图');
        expect(store.recordStickerDecision).toHaveBeenCalledWith(expect.any(String), 'collect', '可爱的猫');
    });

    it('splits large batches into groups of at most four images', async () => {
        tasks.understandStickerBatch.mockImplementation(async (items: unknown[]) => items.map((_, index) => ({
            index, summary: '图', tags: [], safe: true, confidence: 0.9, collect: false,
        })));
        const messages = Array.from({ length: 5 }, (_, index) => message(index + 1, index + 10));
        await service().processBatch(conversation, messages);
        expect(tasks.understandStickerBatch).toHaveBeenCalledTimes(2);
        expect(tasks.understandStickerBatch.mock.calls[0][0]).toHaveLength(4);
        expect(tasks.understandStickerBatch.mock.calls[1][0]).toHaveLength(1);
    });

    it('skips the vision call entirely for recently rejected or unsafe fingerprints', async () => {
        store.getStickerDecision.mockResolvedValue({ fingerprint: 'x', decision: 'reject', summary: '', evaluatedAt: Date.now() });
        await service().processBatch(conversation, [message(1, 1)]);
        expect(tasks.understandStickerBatch).not.toHaveBeenCalled();

        store.getStickerDecision.mockResolvedValue({ fingerprint: 'x', decision: 'unsafe', summary: '', evaluatedAt: 1 });
        await service().processBatch(conversation, [message(1, 1)]);
        expect(tasks.understandStickerBatch).not.toHaveBeenCalled();
    });

    it('re-evaluates a rejection after the cooldown expired', async () => {
        store.getStickerDecision.mockResolvedValue({
            fingerprint: 'x', decision: 'reject', summary: '', evaluatedAt: Date.now() - 8 * 86400000,
        });
        tasks.understandStickerBatch.mockResolvedValue([
            { index: 0, summary: '图', tags: [], safe: true, confidence: 0.9, collect: false },
        ]);
        await service().processBatch(conversation, [message(1, 1)]);
        expect(tasks.understandStickerBatch).toHaveBeenCalledTimes(1);
    });

    it('lets the collect tool refuse when the model decides not to collect', async () => {
        tasks.understandSticker.mockResolvedValue({ summary: '普通截图', tags: [], safe: true, confidence: 0.9, collect: false });
        const target = message(1, 1);
        await expect(service().collect(conversation, target, target.content[0])).rejects.toThrow('模型决定不收藏');
        expect(store.saveSticker).not.toHaveBeenCalled();
        expect(store.recordStickerDecision).toHaveBeenCalledWith(expect.any(String), 'reject', '普通截图');
    });
});

describe('image captioning for non-vision chat models', () => {
    it('uses the configured vision task model to describe images as text', async () => {
        tasks.visionProfile.mockReturnValue({ id: 'vision-only', vision: true });
        tasks.describeImages.mockResolvedValue([{ index: 0, description: '一只举着牌子的猫' }]);
        const { parts } = await service().captionParts([message(1, 1)], 1024 * 1024, conversation);
        expect(tasks.describeImages).toHaveBeenCalledTimes(1);
        expect(parts).toEqual([{ type: 'text', text: '[图片内容：一只举着牌子的猫]' }]);
    });

    it('returns no image parts when no vision-capable task model is configured', async () => {
        const { parts } = await service().captionParts([message(1, 1)], 1024 * 1024, conversation);
        expect(parts).toEqual([]);
        expect(tasks.describeImages).not.toHaveBeenCalled();
    });
});

describe('vision configuration routing', () => {
    const chatProfile = (patch: Partial<ProviderProfile> = {}): ProviderProfile => ({
        id: 'main', name: 'Main', type: 'google', model: 'main-model', apiKey: 'k',
        contextWindow: 1000, maxOutputTokens: 100, temperature: 0.7,
        vision: true, toolCalling: true, structuredOutput: true, ...patch,
    });

    it('inlines images when the vision task inherits the same chat model', async () => {
        tasks.visionProfile.mockReturnValue({ id: 'main', model: 'main-model', vision: true });
        const { parts } = await service().imageParts([message(1, 1)], 1024 * 1024, conversation, chatProfile());
        expect(parts[0].type).toBe('image');
        expect(tasks.describeImages).not.toHaveBeenCalled();
    });

    it('uses the configured cheaper vision model even when the chat model supports vision', async () => {
        tasks.visionProfile.mockReturnValue({ id: 'cheap-vision', model: 'cheap', vision: true });
        tasks.describeImages.mockResolvedValue([{ index: 0, description: '一只猫' }]);
        const { parts } = await service().imageParts([message(1, 1)], 1024 * 1024, conversation, chatProfile());
        expect(parts).toEqual([{ type: 'text', text: '[图片内容：一只猫]' }]);
        expect(tasks.describeImages).toHaveBeenCalledTimes(1);
    });

    it('captions images when the chat model has no vision capability', async () => {
        tasks.visionProfile.mockReturnValue({ id: 'cheap-vision', model: 'cheap', vision: true });
        tasks.describeImages.mockResolvedValue([{ index: 0, description: '一张截图' }]);
        const { parts } = await service().imageParts([message(1, 1)], 1024 * 1024, conversation, chatProfile({ vision: false }));
        expect(parts[0].type).toBe('text');
        expect(tasks.describeImages).toHaveBeenCalledTimes(1);
    });

    it('falls back to inline images when no separate vision model exists', async () => {
        tasks.visionProfile.mockReturnValue(null);
        const { parts } = await service().imageParts([message(1, 1)], 1024 * 1024, conversation, chatProfile());
        expect(parts[0].type).toBe('image');
    });

    it('returns nothing when neither the chat model nor a vision task can see images', async () => {
        tasks.visionProfile.mockReturnValue(null);
        const { parts } = await service().imageParts([message(1, 1)], 1024 * 1024, conversation, chatProfile({ vision: false }));
        expect(parts).toEqual([]);
    });
});
