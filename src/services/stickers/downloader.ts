import dns from 'node:dns/promises';
import net from 'node:net';

export const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface DownloadedImage {
    buffer: Buffer;
    mime: string;
    sourceUrl: string;
}

export function detectMimeFromBuffer(buf: Buffer): string | null {
    if (buf.length < 8) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return 'image/jpeg';
    }
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return 'image/png';
    }
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
        return 'image/gif';
    }
    if (
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
    ) {
        return 'image/webp';
    }
    return null;
}

export async function downloadImage(source: string, maxBytes: number): Promise<DownloadedImage> {
    const cleaned = source.trim().replace(/&amp;/g, '&');
    let current = new URL(cleaned);
    for (let redirects = 0; redirects < 4; redirects += 1) {
        await assertPublicUrl(current);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(current, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                },
            });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) throw new Error('媒体重定向缺少地址');
                current = new URL(location, current);
                continue;
            }
            if (!response.ok) throw new Error(`媒体下载失败 (HTTP ${response.status})`);
            const declared = Number(response.headers.get('content-length') ?? 0);
            if (declared > maxBytes) throw new Error('图片超过大小限制');
            if (!response.body) throw new Error('图片响应为空');
            const chunks: Buffer[] = [];
            let size = 0;
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = Buffer.from(value);
                size += chunk.length;
                if (size > maxBytes) {
                    await reader.cancel();
                    throw new Error('图片超过大小限制');
                }
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            let mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLocaleLowerCase();
            if (mime === 'image/jpg') mime = 'image/jpeg';
            const detected = detectMimeFromBuffer(buffer);
            if (detected) {
                mime = detected;
            } else if (!ALLOWED_MIME.has(mime)) {
                throw new Error(`不支持的图片类型（收到 ${mime || '未知类型'}）`);
            }
            return { buffer, mime, sourceUrl: current.toString() };
        } finally {
            clearTimeout(timeout);
        }
    }
    throw new Error('媒体重定向次数过多');
}

async function assertPublicUrl(url: URL): Promise<void> {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('只允许 HTTP(S) 图片');
    if (url.username || url.password) throw new Error('图片地址不能包含凭证');
    const hostname = url.hostname.toLocaleLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('不允许本地媒体地址');
    const isKnownPublicDomain = hostname.endsWith('.qpic.cn') || hostname.endsWith('.gtimg.cn') || hostname.endsWith('.qq.com') || hostname.endsWith('.tencent.com');
    if (isKnownPublicDomain) return;
    const addresses = net.isIP(hostname) ? [hostname] : (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('不允许私有网络媒体地址');
}

function isPrivateAddress(address: string): boolean {
    if (address.includes(':')) {
        const normalized = address.toLocaleLowerCase();
        return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
            || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
            || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
    }
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
        || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}
