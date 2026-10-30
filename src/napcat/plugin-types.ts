export interface PluginConfigItem {
    key: string;
    type: 'string' | 'number' | 'boolean' | 'select' | 'multi-select' | 'html' | 'text';
    label: string;
    description?: string;
    default?: unknown;
    options?: Array<{ label: string; value: string | number }>;
    placeholder?: string;
    reactive?: boolean;
    hidden?: boolean;
}

export type PluginConfigSchema = PluginConfigItem[];

export interface PluginLogger {
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface PluginHttpRequest {
    path: string;
    method: string;
    query: Record<string, string | string[] | undefined>;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    params: Record<string, string>;
    raw: unknown;
}

export interface PluginHttpResponse {
    status(code: number): PluginHttpResponse;
    json(data: unknown): void;
    send(data: string | Buffer): void;
    setHeader(name: string, value: string): PluginHttpResponse;
    sendFile(filePath: string): void;
    redirect(url: string): void;
    raw: unknown;
}

export type PluginRequestHandler = (req: PluginHttpRequest, res: PluginHttpResponse) => void | Promise<void>;

export interface NapCatConfigClass {
    text(key: string, label: string, defaultValue?: string, description?: string, reactive?: boolean): PluginConfigItem;
    number(key: string, label: string, defaultValue?: number, description?: string, reactive?: boolean): PluginConfigItem;
    boolean(key: string, label: string, defaultValue?: boolean, description?: string, reactive?: boolean): PluginConfigItem;
    html(content: string): PluginConfigItem;
    plainText(content: string): PluginConfigItem;
    combine(...items: PluginConfigItem[]): PluginConfigSchema;
}

export interface NapCatPluginContext {
    pluginName: string;
    pluginPath: string;
    configPath: string;
    dataPath: string;
    adapterName: string;
    NapCatConfig: NapCatConfigClass;
    pluginManager: { config: unknown };
    logger: PluginLogger;
    actions: {
        call(action: string, params: Record<string, unknown>, adapterName: string, config: unknown): Promise<unknown>;
    };
    router: {
        get(path: string, handler: PluginRequestHandler): void;
        post(path: string, handler: PluginRequestHandler): void;
        page(page: { path: string; title: string; htmlFile: string; description?: string; icon?: string }): void;
        static(urlPath: string, localPath: string): void;
    };
}

export interface PluginModule {
    plugin_init: (ctx: NapCatPluginContext) => void | Promise<void>;
    plugin_onmessage?: (ctx: NapCatPluginContext, event: { post_type: string; [key: string]: unknown }) => void | Promise<void>;
    plugin_cleanup?: (ctx: NapCatPluginContext) => void | Promise<void>;
    plugin_get_config?: (ctx: NapCatPluginContext) => unknown | Promise<unknown>;
    plugin_set_config?: (ctx: NapCatPluginContext, config: unknown) => void | Promise<void>;
    plugin_on_config_change?: (
        ctx: NapCatPluginContext,
        ui: unknown,
        key: string,
        value: unknown,
        currentConfig: Record<string, unknown>,
    ) => void | Promise<void>;
}
