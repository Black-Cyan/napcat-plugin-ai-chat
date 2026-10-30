import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = path.resolve(process.argv[2] || 'dist/index.mjs')
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'napcat-ai-chat-smoke-'))
try {
    const bundled = path.join(directory, 'index.mjs')
    await fs.copyFile(entry, bundled)
    const plugin = await import(pathToFileURL(bundled).href)
    const calls = []
    const ctx = {
        pluginName: 'napcat-plugin-ai-chat',
        pluginPath: directory,
        dataPath: path.join(directory, 'data'),
        configPath: path.join(directory, 'config.json'),
        adapterName: 'smoke',
        pluginManager: { config: {} },
        actions: { call: async (name) => { calls.push(name); return { user_id: 10001, nickname: 'SmokeBot' } } },
        logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
        NapCatConfig: {
            html: (content) => ({ key: content, type: 'html', label: '' }),
            boolean: (key, label) => ({ key, type: 'boolean', label }),
            combine: (...items) => items,
        },
        router: {
            static() {}, page() {}, get() {}, post() {},
        },
    }
    await plugin.plugin_init(ctx)
    if (!Array.isArray(plugin.plugin_config_ui)) throw new Error('Config UI was not initialized')
    await plugin.plugin_cleanup()
    if (!calls.includes('get_login_info')) throw new Error('NapCat identity was not initialized')
    console.log('ISOLATED_PLUGIN_INIT_OK')
} finally {
    await fs.rm(directory, { recursive: true, force: true })
}
