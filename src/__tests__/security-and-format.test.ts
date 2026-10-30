import { describe, expect, it } from 'vitest';
import { splitReply } from '../services/chat/chat-orchestrator';
import { downloadImage } from '../services/stickers/downloader';

describe('reply formatting', () => {
    it('keeps replies short and splits natural paragraphs', () => {
        expect(splitReply('第一句\n\n第二句')).toEqual(['第一句', '第二句']);
        expect(splitReply('只有一句话')).toEqual(['只有一句话']);
    });
});

describe('media URL policy', () => {
    it('rejects loopback media before making a request', async () => {
        await expect(downloadImage('http://127.0.0.1/private.png', 1024)).rejects.toThrow('私有网络');
        await expect(downloadImage('file:///etc/passwd', 1024)).rejects.toThrow('HTTP');
    });
});
