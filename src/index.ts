import type {
    PluginModule,
    PluginConfigSchema,
    NapCatPluginContext,
} from './napcat/plugin-types';
import { buildConfigSchema } from './config';
import { pluginState } from './core/state';
import { runtime } from './core/runtime';
import { registerApiRoutes } from './services/api-service';
import { safeDiagnostic } from './core/diagnostics';

export let plugin_config_ui: PluginConfigSchema = [];

export const plugin_init: PluginModule['plugin_init'] = async (ctx) => {
    await runtime.init(ctx);
    plugin_config_ui = buildConfigSchema(ctx);
    registerWebUI(ctx);
    registerApiRoutes(ctx);
    ctx.logger.info(runtime.ready ? 'QQ 智能聊天机器人已初始化' : '管理界面已启动，但运行环境尚未就绪');
};

export const plugin_onmessage: PluginModule['plugin_onmessage'] = async (_ctx, event) => {
    if (event.post_type !== 'message') return;
    try {
        await runtime.onMessage(event);
    } catch (error) {
        pluginState.logger.warn('消息接入失败', safeDiagnostic(error));
    }
};

export const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
    await runtime.cleanup();
};

export const plugin_get_config: PluginModule['plugin_get_config'] = async () => pluginState.publicConfig();

export const plugin_set_config: PluginModule['plugin_set_config'] = async (_ctx, config) => {
    pluginState.replaceConfig(config);
};

export const plugin_on_config_change: PluginModule['plugin_on_config_change'] = async (_ctx, _ui, key, value, currentConfig) => {
    pluginState.updateConfig({ ...currentConfig, [key]: value });
};

function registerWebUI(ctx: NapCatPluginContext): void {
    ctx.router.static('/static', 'webui');
    ctx.router.page({
        path: 'dashboard',
        title: 'AI 聊天控制台',
        htmlFile: 'webui/index.html',
        description: '模型、会话、记忆与表情包管理',
    });
}
