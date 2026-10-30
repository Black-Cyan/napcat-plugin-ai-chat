import { createHash } from 'node:crypto';
import type { ProviderProfile } from '../../types';
import { ProviderError } from '../types';
import { googleJson, googleModelsUrl } from './http';

export interface GoogleModelInfo {
    name: string;
    baseModelId: string;
    displayName: string;
    description: string;
    supportedGenerationMethods: string[];
    inputTokenLimit: number;
    outputTokenLimit: number;
    thinking: boolean;
}

export interface GoogleModelDiscovery {
    models: GoogleModelInfo[];
    fetchedAt: number;
    cached: boolean;
    stale: boolean;
    error?: string;
}

interface CacheEntry {
    models: GoogleModelInfo[];
    fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function discoverGoogleModels(
    profile: ProviderProfile,
    options: { forceRefresh?: boolean } = {},
): Promise<GoogleModelDiscovery> {
    const key = cacheKey(profile);
    const previous = cache.get(key);
    const fresh = previous && Date.now() - previous.fetchedAt < CACHE_TTL_MS;
    if (previous && fresh && !options.forceRefresh) {
        return { models: previous.models, fetchedAt: previous.fetchedAt, cached: true, stale: false };
    }
    try {
        const models = await fetchGoogleModels(profile);
        const fetchedAt = Date.now();
        cache.set(key, { models, fetchedAt });
        return { models, fetchedAt, cached: false, stale: false };
    } catch (error) {
        if (previous) {
            return {
                models: previous.models,
                fetchedAt: previous.fetchedAt,
                cached: true,
                stale: true,
                error: error instanceof ProviderError ? error.message : 'Google 模型列表刷新失败',
            };
        }
        throw error;
    }
}

export async function fetchGoogleModels(profile: ProviderProfile): Promise<GoogleModelInfo[]> {
    const models = new Map<string, GoogleModelInfo>();
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; page < 100; page += 1) {
        if (pageToken) {
            if (seenTokens.has(pageToken)) throw new ProviderError('Google 模型列表分页令牌异常', 502, false, false);
            seenTokens.add(pageToken);
        }
        const payload = await googleJson<any>(googleModelsUrl(profile, 100, pageToken), profile, { method: 'GET' });
        for (const model of Array.isArray(payload.models) ? payload.models : []) {
            if (!model || typeof model.name !== 'string') continue;
            const methods = Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.map(String) : [];
            if (!methods.includes('generateContent') || models.has(model.name)) continue;
            models.set(model.name, {
                name: model.name,
                baseModelId: String(model.baseModelId || model.name.replace(/^models\//, '')),
                displayName: String(model.displayName || model.baseModelId || model.name),
                description: String(model.description || ''),
                supportedGenerationMethods: methods,
                inputTokenLimit: positiveNumber(model.inputTokenLimit),
                outputTokenLimit: positiveNumber(model.outputTokenLimit),
                thinking: model.thinking === true,
            });
        }
        pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken ? payload.nextPageToken : undefined;
        if (!pageToken) return [...models.values()];
    }
    throw new ProviderError('Google 模型列表分页过多', 502, false, false);
}

export async function selectGoogleModel(profile: ProviderProfile): Promise<GoogleModelInfo> {
    const discovery = await discoverGoogleModels(profile);
    if (!discovery.models.length) throw new ProviderError('Google 账号没有可用于聊天的 generateContent 模型', 400, false, false);
    const current = profile.model.trim();
    if (!current) return discovery.models[0];
    const id = current.replace(/^models\//, '');
    const selected = discovery.models.find((model) => model.baseModelId === id || model.name === current);
    if (!selected) throw new ProviderError('当前 Google 模型已不可用，请刷新模型列表并重新选择', 400, false, false);
    return selected;
}

export function clearGoogleModelCache(): void {
    cache.clear();
}

function cacheKey(profile: ProviderProfile): string {
    const fingerprint = createHash('sha256').update(profile.apiKey).digest('hex');
    return `${profile.id}:${profile.baseUrl?.trim().replace(/\/+$/, '') || 'official'}:${fingerprint}`;
}

function positiveNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
