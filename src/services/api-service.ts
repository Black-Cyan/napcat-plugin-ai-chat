import { z } from 'zod';
import type { NapCatPluginContext, PluginHttpRequest, PluginHttpResponse } from '../napcat/plugin-types';
import { pluginState, SECRET_MASK } from '../core/state';
import { runtime } from '../core/runtime';
import { runtimeLogs } from '../core/log-buffer';
import { createDatabase } from '../database/database';
import { ProviderRegistry } from '../providers/registry';
import { textMessage } from '../providers/types';
import type { DatabaseConfig, ProviderProfile } from '../types';
import { normalizeSubjectId } from '../types';
import { getFriendList, getGroupList } from '../napcat/actions';
import { discoverGoogleModels } from '../providers/google/models';
import { safeDiagnostic } from '../core/diagnostics';
import { sessionOverrideSchema } from '../config';

const idSchema = z.string().min(1).max(128);
const blacklistSchema = z.object({ type: z.enum(['user', 'group']), id: z.string().regex(/^\d+$/), action: z.enum(['add', 'remove']) });
const promptSchema = z.object({
    id: z.string().uuid().optional(), name: z.string().min(1).max(100), content: z.string().max(50000), isDefault: z.boolean().optional(),
});
const googleDiscoverySchema = z.object({
    id: z.string().min(1).max(128),
    apiKey: z.string(),
    baseUrl: z.string().optional(),
    refresh: z.boolean().optional(),
});
const accessModeSchema = z.object({
    mode: z.enum(['blacklist', 'whitelist']),
    activeBlacklistId: z.string().nullable().optional(),
    activeWhitelistId: z.string().nullable().optional(),
});
const accessListCreateSchema = z.object({
    type: z.enum(['blacklist', 'whitelist']),
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
});
const accessListUpdateSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
});
const accessMemberAddSchema = z.object({
    members: z.array(z.object({
        subjectType: z.enum(['user', 'group']),
        subjectId: z.string().min(1).max(64),
        note: z.string().max(200).optional(),
    })).min(1).max(1000),
});
const accessMemberRemoveSchema = z.object({
    subjectType: z.enum(['user', 'group']),
    subjectId: z.string().min(1).max(64),
});
const databaseSchema = z.object({
    driver: z.enum(['sqlite', 'postgres', 'mysql']), sqliteFile: z.string().min(1),
    connectionString: z.string(), poolSize: z.number().int().min(1).max(100), tls: z.boolean(),
});

export function registerApiRoutes(ctx: NapCatPluginContext): void {
    const router = ctx.router;
    router.get('/status', handler(async () => ({
        ...runtime.status(),
        initializationError: runtime.initializationError,
        resources: runtime.store ? await runtime.store.stats() : null,
    })));
    router.get('/config', handler(async () => pluginState.publicConfig()));
    router.post('/config', handler(async (req) => {
        pluginState.updateConfig(req.body ?? {});
        return { config: pluginState.publicConfig(), restartRequired: Boolean((req.body as Record<string, unknown> | undefined)?.database) };
    }));
    router.post('/providers/test', handler(async (req) => {
        const id = idSchema.parse((req.body as Record<string, unknown>)?.id);
        const registry = new ProviderRegistry(() => pluginState.config.providers);
        const profile = registry.profile(id);
        const response = await registry.generate(profile, {
            profile, messages: [textMessage('user', '只回复 OK，用于连接测试。')],
        });
        return { ok: true, model: profile.model, usage: response.usage };
    }));
    router.post('/providers/models', handler(async (req) => {
        const input = googleDiscoverySchema.parse(req.body);
        const profile = resolveGoogleProfile(input, pluginState.config.providers);
        return discoverGoogleModels(profile, { forceRefresh: input.refresh === true });
    }));
    router.post('/database/test', handler(async (req) => {
        const config = databaseSchema.parse(req.body) as DatabaseConfig;
        if (config.connectionString === SECRET_MASK) config.connectionString = pluginState.config.database.connectionString;
        const database = await createDatabase(config, ctx.dataPath, false);
        try { return { ok: await database.healthCheck() }; } finally { await database.close(); }
    }));

    router.get('/prompts', handler(async () => requireStore().listPrompts()));
    router.post('/prompts', handler(async (req) => requireStore().savePrompt(promptSchema.parse(req.body))));
    router.post('/prompts/:id/delete', handler(async (req) => {
        await requireStore().deletePrompt(idSchema.parse(param(req, 'id')));
        return { ok: true };
    }));

    router.get('/conversations', handler(async (req) => requireStore().listConversations(query(req, 'search'))));
    router.get('/conversations/:id/messages', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const conversation = await requireStore().getConversation(id);
        if (!conversation) throw new Error('会话不存在');
        const messages = await requireStore().getRecentMessages(id, conversation.nextSeq + 1, 500, false);
        return messages.map((message) => ({
            id: message.id, seq: message.seq, senderId: message.senderId, senderName: message.senderName,
            senderKind: message.senderKind, role: message.role, content: message.content, occurredAt: message.occurredAt,
        }));
    }));
    router.post('/conversations/:id/config', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const body = sessionOverrideSchema.extend({ title: z.string().max(200).optional() }).parse(req.body);
        await requireStore().updateConversation(id, {
            title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
            override: {
                enabled: body.enabled,
                behavior: body.behavior,
                vision: body.vision,
                stickers: body.stickers,
            },
            promptProfileId: body.promptProfileId,
            providerProfileId: body.providerProfileId,
        });
        return { ok: true };
    }));
    router.post('/conversations/:id/delete', handler(async (req) => {
        await requireStore().deleteConversation(idSchema.parse(param(req, 'id')));
        return { ok: true };
    }));

    router.get('/memories', handler(async (req) => requireStore().listMemories(query(req, 'search'))));
    router.post('/memories/:id', handler(async (req) => {
        const body = z.object({
            content: z.string().min(1).max(2000).optional(), valid: z.boolean().optional(), scope: z.enum(['private', 'group']).optional(),
        }).parse(req.body);
        await requireStore().updateMemory(idSchema.parse(param(req, 'id')), body);
        return { ok: true };
    }));
    router.post('/memories/:id/delete', handler(async (req) => {
        await requireStore().deleteMemory(idSchema.parse(param(req, 'id')));
        return { ok: true };
    }));

    router.get('/blacklist', handler(async () => requireStore().listBlacklist()));
    router.post('/blacklist', handler(async (req) => {
        const input = blacklistSchema.parse(req.body);
        if (!runtime.accessControl) throw new Error('访问控制服务未就绪');
        const normId = normalizeSubjectId(input.id);
        if (input.action === 'add' && input.type === 'user' && pluginState.config.owners.length <= 1 && pluginState.config.owners[0] === normId) {
            throw new Error('不能拉黑最后一个所有者');
        }
        if (input.action === 'add') await requireStore().addBlacklist(input.type, normId);
        else await requireStore().removeBlacklist(input.type, normId);
        await runtime.accessControl.refresh();
        return { ok: true };
    }));

    router.get('/access-control', handler(async () => {
        if (!runtime.accessControl) throw new Error('访问控制服务未就绪');
        const state = await requireStore().getAccessControlState();
        const snapshot = runtime.accessControl.getSnapshot();
        const lists = await requireStore().listAccessLists();
        return { state, snapshot, lists };
    }));

    router.post('/access-control/mode', handler(async (req) => {
        if (!runtime.accessControl) throw new Error('访问控制服务未就绪');
        const input = accessModeSchema.parse(req.body);
        const result = await runtime.accessControl.setMode(input.mode, input.activeBlacklistId, input.activeWhitelistId);
        return { ok: true, state: result };
    }));

    router.get('/access-control/lists', handler(async (req) => {
        const type = query(req, 'type') as 'blacklist' | 'whitelist' | undefined;
        return requireStore().listAccessLists(type === 'blacklist' || type === 'whitelist' ? type : undefined);
    }));

    router.post('/access-control/lists', handler(async (req) => {
        const input = accessListCreateSchema.parse(req.body);
        return requireStore().createAccessList(input.type, input.name, input.description || '');
    }));

    router.get('/access-control/lists/:id', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const list = await requireStore().getAccessList(id);
        if (!list) throw new Error('名单不存在');
        const members = await requireStore().listAccessListMembers(id);
        return { list, members };
    }));

    router.post('/access-control/lists/:id', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const input = accessListUpdateSchema.parse(req.body);
        const updated = await requireStore().updateAccessList(id, input);
        if (runtime.accessControl) await runtime.accessControl.refresh();
        return updated;
    }));

    router.post('/access-control/lists/:id/delete', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        await requireStore().deleteAccessList(id);
        if (runtime.accessControl) await runtime.accessControl.refresh();
        return { ok: true };
    }));

    router.post('/access-control/lists/:id/duplicate', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const body = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
        return requireStore().duplicateAccessList(id, body.name);
    }));

    router.post('/access-control/lists/:id/members', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const input = accessMemberAddSchema.parse(req.body);
        const res = await requireStore().addAccessListMembers(id, input.members);
        if (runtime.accessControl) await runtime.accessControl.refresh();
        return res;
    }));

    router.post('/access-control/lists/:id/members/remove', handler(async (req) => {
        const id = idSchema.parse(param(req, 'id'));
        const input = accessMemberRemoveSchema.parse(req.body);
        await requireStore().removeAccessListMember(id, input.subjectType, input.subjectId);
        if (runtime.accessControl) await runtime.accessControl.refresh();
        return { ok: true };
    }));

    router.get('/access-control/contacts', handler(async (req) => {
        const refresh = query(req, 'refresh') === 'true';
        const [groups, friends] = await Promise.all([
            getGroupList(ctx, refresh).catch(() => []),
            getFriendList(ctx, refresh).catch(() => []),
        ]);
        return { groups, friends };
    }));

    router.get('/stickers', handler(async (req) => requireStore().listStickers(query(req, 'search'))));
    router.get('/stickers/:id/media', handler(async (req) => {
        if (!runtime.stickers) throw new Error('表情服务未就绪');
        const media = await runtime.stickers.readMedia(idSchema.parse(param(req, 'id')));
        return { mime: media.mime, data: media.data.toString('base64') };
    }));
    router.post('/stickers/:id', handler(async (req) => {
        const body = z.object({ enabled: z.boolean().optional(), summary: z.string().min(1).max(2000).optional() }).parse(req.body);
        await requireStore().updateSticker(idSchema.parse(param(req, 'id')), body);
        return { ok: true };
    }));
    router.post('/stickers/:id/delete', handler(async (req) => {
        if (!runtime.stickers) throw new Error('表情服务未就绪');
        await runtime.stickers.remove(idSchema.parse(param(req, 'id')));
        return { ok: true };
    }));

    router.get('/logs', handler(async () => runtimeLogs.list()));
    router.post('/logs/clear', handler(async () => {
        runtimeLogs.clear();
        return { ok: true };
    }));
    router.get('/export', handler(async () => requireStore().exportData()));
    router.post('/import', handler(async (req) => {
        if (typeof req.body !== 'object' || req.body === null) throw new Error('导入数据无效');
        const applyAccess = query(req, 'applyAccessControl') === 'true';
        await requireStore().importData(req.body as Record<string, unknown>, applyAccess);
        if (runtime.accessControl) await runtime.accessControl.refresh();
        return { ok: true };
    }));
}

function requireStore() {
    if (!runtime.store) throw new Error('数据库尚未就绪');
    return runtime.store;
}

function handler(
    action: (req: PluginHttpRequest, res: PluginHttpResponse) => Promise<unknown>,
) {
    return async (req: PluginHttpRequest, res: PluginHttpResponse) => {
        try {
            const data = await action(req, res);
            res.json({ code: 0, data });
        } catch (error) {
            const message = safeDiagnostic(error);
            runtimeLogs.add('warn', message);
            res.status(400).json({ code: -1, message: message.slice(0, 300) });
        }
    };
}

function param(req: PluginHttpRequest, name: string): string {
    const value = req.params?.[name];
    if (typeof value !== 'string') throw new Error('缺少路径参数');
    return value;
}

function query(req: PluginHttpRequest, name: string): string {
    const value = (req as PluginHttpRequest & { query?: Record<string, unknown> }).query?.[name];
    return typeof value === 'string' ? value.slice(0, 200) : '';
}

export function resolveGoogleProfile(
    input: { id: string; apiKey: string; baseUrl?: string },
    profiles: ProviderProfile[],
): ProviderProfile {
    const saved = profiles.find((profile) => profile.id === input.id);
    if (saved && saved.type !== 'google') throw new Error('只有 Google Gemini 配置支持动态模型发现');
    const apiKey = input.apiKey === SECRET_MASK ? saved?.apiKey : input.apiKey;
    if (!apiKey) throw new Error('请先填写 Google API Key');
    return saved ? { ...saved, baseUrl: input.baseUrl, apiKey } : {
        id: input.id,
        name: 'Google Gemini',
        type: 'google',
        model: '',
        apiKey,
        baseUrl: input.baseUrl,
        contextWindow: 128000,
        maxOutputTokens: 4096,
        temperature: 0.7,
        vision: true,
        toolCalling: true,
        structuredOutput: true,
    };
}
