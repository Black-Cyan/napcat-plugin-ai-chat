import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeSegments, parseCqCode } from '../napcat/message-segments';
import { detectMimeFromBuffer, downloadImage } from '../services/stickers/downloader';
import { StickerService } from '../services/stickers/sticker-service';
import { pluginState } from '../core/state';
import { GoogleAdapter } from '../providers/google/adapter';
import type { ChatMessage, MessageSegment } from '../types';

const TINY_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

describe('CQ Code & Segment Normalization', () => {
    it('parses CQ image codes with HTML-escaped URLs into structured segments', () => {
        const raw = '看图：[CQ:image,file=test.jpg,url=https://gchat.qpic.cn/download?appid=1407&amp;fileid=abc&amp;spec=0] 怎么样';
        const segments = normalizeSegments(raw, raw);
        expect(segments).toHaveLength(3);
        expect(segments[0]).toEqual({ type: 'text', data: { text: '看图：' } });
        expect(segments[1]).toEqual({
            type: 'image',
            data: {
                file: 'test.jpg',
                url: 'https://gchat.qpic.cn/download?appid=1407&fileid=abc&spec=0',
            },
        });
        expect(segments[2]).toEqual({ type: 'text', data: { text: ' 怎么样' } });
    });

    it('unescapes &amp; in array segments', () => {
        const input: MessageSegment[] = [
            {
                type: 'image',
                data: {
                    file: '594A8E.jpg',
                    url: 'https://gchat.qpic.cn/download?appid=1407&amp;fileid=EhQLRc08jNR&amp;rkey=CAQSKAB6',
                },
            },
        ];
        const normalized = normalizeSegments(input, '');
        expect(normalized[0].data.url).toBe('https://gchat.qpic.cn/download?appid=1407&fileid=EhQLRc08jNR&rkey=CAQSKAB6');
    });
});

describe('Magic Byte Sniffing & Downloader', () => {
    it('detects MIME types accurately from buffers', () => {
        expect(detectMimeFromBuffer(TINY_PNG)).toBe('image/png');
        expect(detectMimeFromBuffer(TINY_JPEG)).toBe('image/jpeg');
        expect(detectMimeFromBuffer(Buffer.from('not an image'))).toBeNull();
    });

    it('recovers MIME when server returns application/octet-stream', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(TINY_JPEG, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const downloaded = await downloadImage('https://gchat.qpic.cn/download?appid=1407&amp;fileid=test', 1024 * 1024);
        expect(downloaded.mime).toBe('image/jpeg');
        expect(downloaded.buffer).toEqual(TINY_JPEG);
        expect(downloaded.sourceUrl).toBe('https://gchat.qpic.cn/download?appid=1407&fileid=test');
    });
});

describe('StickerService Multi-source Resolution', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'img-pipe-test-'));
    });

    afterEach(async () => {
        vi.unstubAllGlobals();
        pluginState.setContextForTest(null);
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('resolves Base64 image data URLs directly without network requests', async () => {
        const service = new StickerService({} as any, {} as any);
        const dataUrl = `data:image/png;base64,${TINY_PNG.toString('base64')}`;
        const message: ChatMessage = {
            id: 'm1', seq: 1, conversationId: 'c1', senderId: 'u1', senderName: 'Alice', senderKind: 'human',
            role: 'user', content: [{ type: 'image', data: { file: dataUrl } }],
            batchId: null, napcatMessageId: null, rawEvent: null, occurredAt: Date.now(), receivedAt: Date.now(),
        };
        const parts = await service.visionParts([message], 1024 * 1024);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({
            type: 'image',
            mime: 'image/png',
            data: TINY_PNG.toString('base64'),
        });
    });

    it('resolves local file paths when NapCat caches images on disk', async () => {
        const localFile = path.join(tmpDir, 'cached.jpg');
        await fs.writeFile(localFile, TINY_JPEG);

        const service = new StickerService({} as any, {} as any);
        const message: ChatMessage = {
            id: 'm2', seq: 2, conversationId: 'c1', senderId: 'u1', senderName: 'Alice', senderKind: 'human',
            role: 'user', content: [{ type: 'image', data: { file: localFile } }],
            batchId: null, napcatMessageId: null, rawEvent: null, occurredAt: Date.now(), receivedAt: Date.now(),
        };
        const parts = await service.visionParts([message], 1024 * 1024);
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({
            type: 'image',
            mime: 'image/jpeg',
            data: TINY_JPEG.toString('base64'),
        });
    });

    it('falls back to NapCat get_image action when direct URL is expired', async () => {
        // Direct download fails with expired URL
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ retcode: -5503007, retmsg: 'download url has expired' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const mockCall = vi.fn().mockImplementation((name, params) => {
            if (name === 'get_image') {
                return Promise.resolve({
                    file: 'cached-img.png',
                    base64: `data:image/png;base64,${TINY_PNG.toString('base64')}`,
                });
            }
            return Promise.reject(new Error('Unknown action'));
        });

        pluginState.setContextForTest({
            actions: { call: mockCall },
            adapterName: 'test',
            pluginManager: { config: {} },
        } as any);

        const service = new StickerService({} as any, {} as any);
        const message: ChatMessage = {
            id: 'm3', seq: 3, conversationId: 'c1', senderId: 'u1', senderName: 'Alice', senderKind: 'human',
            role: 'user', content: [{
                type: 'image',
                data: {
                    file: '594A8E2AF6A2E856E022E1DBBEF47515.jpg',
                    url: 'https://gchat.qpic.cn/download?expired=1',
                },
            }],
            batchId: null, napcatMessageId: null, rawEvent: null, occurredAt: Date.now(), receivedAt: Date.now(),
        };

        const parts = await service.visionParts([message], 1024 * 1024);
        expect(mockCall).toHaveBeenCalledWith('get_image', { file: '594A8E2AF6A2E856E022E1DBBEF47515.jpg' }, 'test', {});
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({
            type: 'image',
            mime: 'image/png',
            data: TINY_PNG.toString('base64'),
        });
    });
});

describe('Google Gemini Multimodal Adapter', () => {
    it('normalizes image/jpg to image/jpeg and formats inlineData correctly', async () => {
        const fetchMock = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/models?')) {
                return Promise.resolve(new Response(JSON.stringify({
                    models: [{ name: 'models/gemini-test', supportedGenerationMethods: ['generateContent'] }],
                })));
            }
            return Promise.resolve(new Response(JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: 'I see a tiny jpeg' }] }, finishReason: 'STOP' }],
            })));
        });
        vi.stubGlobal('fetch', fetchMock);

        const adapter = new GoogleAdapter();
        const res = await adapter.generate({
            profile: {
                id: 'g1', name: 'Google', type: 'google', model: 'gemini-test', apiKey: 'sec',
                contextWindow: 100000, maxOutputTokens: 100, temperature: 0.7,
                vision: true, toolCalling: true, structuredOutput: true,
            },
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: '描述此图片' },
                        { type: 'image', mime: 'image/jpg', data: TINY_JPEG.toString('base64') },
                    ],
                },
            ],
        });

        expect(res.text).toBe('I see a tiny jpeg');
        const [url, init] = fetchMock.mock.calls.find(([target]) => String(target).includes(':generateContent'))!;
        const body = JSON.parse(String(init.body));
        expect(body.contents[0].parts[1].inlineData).toEqual({
            mimeType: 'image/jpeg',
            data: TINY_JPEG.toString('base64'),
        });
    });
});
