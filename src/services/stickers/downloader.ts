import dns from 'node:dns/promises';
import net from 'node:net';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface DownloadedImage {
    buffer: Buffer;
    mime: string;
    sourceUrl: string;
}

export async function downloadImage(source: string, maxBytes: number): Promise<DownloadedImage> {
    let current = new URL(source);
    for (let redirects = 0; redirects < 4; redirects += 1) {
        await assertPublicUrl(current);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(current, { signal: controller.signal, redirect: 'manual' });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) throw new Error('媒体重定向缺少地址');
                current = new URL(location, current);
                continue;
            }
            if (!response.ok) throw new Error('媒体下载失败');
            const mime = (response.headers.get('content-type') ?? '').split(';')[0].toLocaleLowerCase();
            if (!ALLOWED_MIME.has(mime)) throw new Error('不支持的图片类型');
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
            return { buffer: Buffer.concat(chunks), mime, sourceUrl: current.toString() };
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
