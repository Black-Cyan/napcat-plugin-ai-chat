import fs from 'node:fs';
import path from 'node:path';
import type { NapCatPluginContext, PluginLogger } from '../napcat/plugin-types';
import { createDefaultConfig, sanitizeConfig } from '../config';
import type { PluginConfig } from '../types';

const SECRET_MASK = '__KEEP_SECRET__';

class PluginState {
    private context: NapCatPluginContext | null = null;
    config: PluginConfig = createDefaultConfig();
    selfId = '';
    selfName = '';

    get ctx(): NapCatPluginContext {
        if (!this.context) throw new Error('插件尚未初始化');
        return this.context;
    }

    get logger(): PluginLogger {
        return this.ctx.logger;
    }

    init(ctx: NapCatPluginContext): void {
        this.context = ctx;
        fs.mkdirSync(ctx.dataPath, { recursive: true, mode: 0o700 });
        fs.mkdirSync(this.getDataFilePath('media'), { recursive: true, mode: 0o700 });
        this.loadConfig();
        this.config.stats.startedAt = Date.now();
        this.saveConfig();
    }

    async fetchSelfId(): Promise<void> {
        try {
            const result = await this.ctx.actions.call(
                'get_login_info', {}, this.ctx.adapterName, this.ctx.pluginManager.config,
            ) as { user_id?: string | number; nickname?: string };
            this.selfId = result.user_id == null ? '' : String(result.user_id);
            this.selfName = result.nickname ?? '';
        } catch {
            this.logger.warn('无法获取机器人身份；自身消息去重将在身份可用后生效');
        }
    }

    cleanup(): void {
        this.saveConfig();
        this.context = null;
        this.selfId = '';
        this.selfName = '';
    }

    getDataFilePath(filename: string): string {
        return path.join(this.ctx.dataPath, filename);
    }

    loadConfig(): void {
        try {
            const raw = fs.existsSync(this.ctx.configPath)
                ? JSON.parse(fs.readFileSync(this.ctx.configPath, 'utf8'))
                : createDefaultConfig();
            this.config = sanitizeConfig(raw);
            this.saveConfig();
        } catch {
            this.config = createDefaultConfig();
            this.saveConfig();
        }
    }

    saveConfig(): void {
        if (!this.context) return;
        const target = this.ctx.configPath;
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, target);
    }

    updateConfig(patch: unknown): PluginConfig {
        const candidate = preserveMaskedSecrets(patch, this.config) as PluginConfig;
        this.config = sanitizeConfig(candidate, this.config);
        this.saveConfig();
        return this.config;
    }

    replaceConfig(config: unknown): PluginConfig {
        return this.updateConfig(config);
    }

    publicConfig(): PluginConfig {
        const clone = structuredClone(this.config);
        for (const provider of clone.providers) provider.apiKey = provider.apiKey ? SECRET_MASK : '';
        if (clone.database.connectionString) clone.database.connectionString = SECRET_MASK;
        return clone;
    }

    incrementProcessed(reply = false): void {
        this.config.stats.processed += 1;
        if (reply) this.config.stats.replies += 1;
        this.saveConfig();
    }

    getUptime(): number {
        return Math.max(0, Date.now() - this.config.stats.startedAt);
    }
}

function preserveMaskedSecrets(patch: unknown, current: PluginConfig): unknown {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
    const clone = structuredClone(patch) as Partial<PluginConfig>;
    if (clone.database?.connectionString === SECRET_MASK) {
        clone.database.connectionString = current.database.connectionString;
    }
    if (Array.isArray(clone.providers)) {
        clone.providers = clone.providers.map((provider) => {
            if (provider.apiKey !== SECRET_MASK) return provider;
            const existing = current.providers.find((item) => item.id === provider.id);
            return { ...provider, apiKey: existing?.apiKey ?? '' };
        });
    }
    return clone;
}

export const pluginState = new PluginState();
export { SECRET_MASK };
