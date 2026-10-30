import { z } from 'zod';
import type { NapCatPluginContext, PluginConfigSchema } from './napcat/plugin-types';
import type { PluginConfig } from './types';

const behaviorSchema = z.object({
    engagement: z.number().min(0).max(1),
    quietMs: z.number().int().min(0).max(120000),
    maxWaitMs: z.number().int().min(100).max(600000),
    maxBatchMessages: z.number().int().min(1).max(200),
    replyCooldownMs: z.number().int().min(0).max(3600000),
    sameSourceBurstThreshold: z.number().int().min(1).max(200),
    botRoundLimit: z.number().int().min(1).max(100),
    maxConcurrentTasks: z.number().int().min(1).max(64),
    recentMessageCount: z.number().int().min(1).max(500),
    maxInputTokens: z.number().int().min(0),
    inputBudgetRatio: z.number().min(0.1).max(0.95),
    compressionTriggerRatio: z.number().min(0.1).max(1),
    maxContextRetries: z.number().int().min(0).max(5),
});

const providerSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(['openai', 'anthropic', 'google']),
    model: z.string().min(1),
    apiKey: z.string(),
    baseUrl: z.string().optional(),
    contextWindow: z.number().int().min(1024),
    maxOutputTokens: z.number().int().min(1),
    temperature: z.number().min(0).max(2),
    vision: z.boolean(),
    toolCalling: z.boolean(),
    structuredOutput: z.boolean(),
});

export const sessionOverrideSchema = z.object({
    enabled: z.boolean().optional(),
    promptProfileId: z.string().nullable().optional(),
    providerProfileId: z.string().nullable().optional(),
    behavior: behaviorSchema.partial().optional(),
    vision: z.boolean().optional(),
    stickers: z.object({
        enabled: z.boolean(),
        autoCollect: z.boolean(),
        autoSend: z.boolean(),
        maxImageBytes: z.number().int().min(1024),
        cacheLimitMb: z.number().int().min(1),
    }).partial().optional(),
});

export const pluginConfigSchema = z.object({
    enabled: z.boolean(),
    debug: z.boolean(),
    commandPrefix: z.string().min(1).max(8),
    owners: z.array(z.string().regex(/^\d+$/)),
    defaultProviderId: z.string().nullable(),
    taskProviders: z.object({
        summary: z.string().nullable(),
        memory: z.string().nullable(),
        vision: z.string().nullable(),
    }),
    providers: z.array(providerSchema),
    database: z.object({
        driver: z.enum(['sqlite', 'postgres', 'mysql']),
        sqliteFile: z.string().min(1),
        connectionString: z.string(),
        poolSize: z.number().int().min(1).max(100),
        tls: z.boolean(),
    }),
    behavior: behaviorSchema,
    privateDefaults: sessionOverrideSchema,
    groupDefaults: sessionOverrideSchema,
    stickers: z.object({
        enabled: z.boolean(),
        autoCollect: z.boolean(),
        autoSend: z.boolean(),
        maxImageBytes: z.number().int().min(1024),
        cacheLimitMb: z.number().int().min(1),
    }),
    stats: z.object({
        processed: z.number().int().nonnegative(),
        replies: z.number().int().nonnegative(),
        startedAt: z.number().nonnegative(),
    }),
});

export function createDefaultConfig(): PluginConfig {
    return {
        enabled: true,
        debug: false,
        commandPrefix: '#',
        owners: [],
        defaultProviderId: null,
        taskProviders: { summary: null, memory: null, vision: null },
        providers: [],
        database: {
            driver: 'sqlite',
            sqliteFile: 'ai-chat.sqlite',
            connectionString: '',
            poolSize: 5,
            tls: false,
        },
        behavior: {
            engagement: 0.7,
            quietMs: 3000,
            maxWaitMs: 15000,
            maxBatchMessages: 20,
            replyCooldownMs: 2000,
            sameSourceBurstThreshold: 8,
            botRoundLimit: 3,
            maxConcurrentTasks: 3,
            recentMessageCount: 30,
            maxInputTokens: 0,
            inputBudgetRatio: 0.75,
            compressionTriggerRatio: 0.8,
            maxContextRetries: 2,
        },
        privateDefaults: {},
        groupDefaults: {},
        stickers: {
            enabled: true,
            autoCollect: true,
            autoSend: true,
            maxImageBytes: 10 * 1024 * 1024,
            cacheLimitMb: 512,
        },
        stats: { processed: 0, replies: 0, startedAt: Date.now() },
    };
}

export function sanitizeConfig(raw: unknown, previous?: PluginConfig): PluginConfig {
    const defaults = previous ?? createDefaultConfig();
    const parsed = pluginConfigSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaults;
    const merged = deepMerge(defaults, raw);
    const result = pluginConfigSchema.safeParse(merged);
    return result.success ? result.data : defaults;
}

function deepMerge(base: unknown, patch: unknown): unknown {
    if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch;
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch;
    const output: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        output[key] = key in output ? deepMerge(output[key], value) : value;
    }
    return output;
}

export function buildConfigSchema(ctx: NapCatPluginContext): PluginConfigSchema {
    return ctx.NapCatConfig.combine(
        ctx.NapCatConfig.html('<div style="padding:16px"><strong>QQ 智能聊天机器人</strong><p>完整配置请使用插件管理控制台。</p></div>'),
        ctx.NapCatConfig.boolean('enabled', '启用插件', true, '关闭后停止模型响应，原始消息保留规则不变', true),
        ctx.NapCatConfig.boolean('debug', '调试日志', false, '不记录消息正文、密钥或账号信息', true),
    );
}
