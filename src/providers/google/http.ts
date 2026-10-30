import type { ProviderProfile } from '../../types';
import { ProviderError } from '../types';

export const GOOGLE_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export function googleApiRoot(baseUrl?: string): string {
    const root = (baseUrl?.trim() || GOOGLE_API_ROOT).replace(/\/+$/, '');
    return root.endsWith('/models') ? root.slice(0, -'/models'.length) : root;
}

export function googleModelResource(model: string): string {
    const id = model.trim().replace(/^models\//, '');
    if (!id || id.includes('/')) throw new ProviderError('Google 模型资源名无效', 400, false, false);
    return `models/${encodeURIComponent(id)}`;
}

export function googleGenerationUrl(profile: ProviderProfile, model: string, stream: boolean): string {
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return `${googleApiRoot(profile.baseUrl)}/${googleModelResource(model)}:${method}`;
}

export function googleModelsUrl(profile: ProviderProfile, pageSize: number, pageToken?: string): string {
    const url = new URL(`${googleApiRoot(profile.baseUrl)}/models`);
    url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    return url.toString();
}

interface GoogleRequestOptions {
    method?: 'GET' | 'POST';
    body?: unknown;
    signal?: AbortSignal;
}

export async function googleJson<T = any>(url: string, profile: ProviderProfile, options: GoogleRequestOptions = {}): Promise<T> {
    return requestGoogle(url, profile, options, async (response) => {
        const text = await response.text();
        try {
            return text ? JSON.parse(text) as T : {} as T;
        } catch {
            throw new ProviderError('Google 返回了无效 JSON', 502, false, false);
        }
    });
}

export async function googleSse(
    url: string,
    profile: ProviderProfile,
    options: GoogleRequestOptions,
    onChunk: (payload: any) => void,
): Promise<void> {
    return requestGoogle(url, profile, options, async (response) => {
        if (!response.body) throw new ProviderError('Google 流式响应缺少正文', 502, false, false);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
                const event = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const payload = parseSseEvent(event);
                if (payload !== undefined) onChunk(payload);
                boundary = buffer.indexOf('\n\n');
            }
        }
        buffer += decoder.decode().replace(/\r\n/g, '\n');
        if (buffer.trim()) {
            const payload = parseSseEvent(buffer);
            if (payload !== undefined) onChunk(payload);
        }
    });
}

function parseSseEvent(event: string): any | undefined {
    const data = event.split('\n').filter((line) => !line.startsWith(':'))
        .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') return undefined;
    try {
        return JSON.parse(data);
    } catch {
        throw new ProviderError('Google 流式响应包含无效 JSON', 502, false, false);
    }
}

async function requestGoogle<T>(
    url: string,
    profile: ProviderProfile,
    options: GoogleRequestOptions,
    consume: (response: Response) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
        const response = await fetch(url, {
            method: options.method ?? 'POST',
            headers: {
                'x-goog-api-key': profile.apiKey,
                ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
            signal: controller.signal,
        });
        if (!response.ok) {
            const text = await response.text();
            let payload: any = null;
            try { payload = text ? JSON.parse(text) : null; } catch { /* sanitized below */ }
            throw googleHttpError(response.status, payload);
        }
        return await consume(response);
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('Google 网络请求失败', 0, false, true);
    } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
    }
}

function googleHttpError(status: number, payload: any): ProviderError {
    const code = String(payload?.error?.status ?? '');
    const diagnostic = String(payload?.error?.message ?? '');
    if (status === 401 || status === 403 || code === 'UNAUTHENTICATED' || code === 'PERMISSION_DENIED') {
        return new ProviderError('Google API 鉴权失败，请检查 API Key 与 Generative Language API 权限', status, false, false);
    }
    if (status === 413 || (status === 400 && /(?:input|prompt).*token.*(?:exceed|too many|too long|limit)|context.*(?:too long|overflow)/i.test(diagnostic))) {
        return new ProviderError('Google 输入上下文超出模型限制', status, true, false);
    }
    if (status === 404) return new ProviderError('Google 模型或接口不存在，请刷新模型列表并重新选择', status, false, false);
    if (status === 429) return new ProviderError('Google API 请求受到限流，请稍后重试', status, false, true);
    const retryable = status === 408 || status === 409 || status >= 500;
    return new ProviderError(`Google 请求失败（HTTP ${status}${code ? ` ${code}` : ''}）`, status, false, retryable);
}
