import { useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { postJson } from '../utils/api'
import type { ProviderProfile, ProviderType } from '../types'
import { Badge, Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Select, Toggle } from '../components/ui'
import GoogleModelField from '../components/GoogleModelField'

const blank = (): ProviderProfile => ({
    id: crypto.randomUUID(), name: '新模型', type: 'openai', model: '', apiKey: '', baseUrl: '',
    contextWindow: 128000, maxOutputTokens: 4096, temperature: 0.7,
    vision: false, toolCalling: true, structuredOutput: true,
})

export default function ProvidersPage() {
    const { config, setConfig, saving, error, notice, save } = useConfig()
    const [selected, setSelected] = useState<string | null>(null)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState('')
    if (!config) return <><ErrorNotice message={error} /><Loading label="正在读取模型配置" /></>
    const current = config.providers.find((item) => item.id === selected) ?? config.providers[0] ?? null
    const patch = (value: Partial<ProviderProfile>) => {
        if (!current) return
        setConfig({ ...config, providers: config.providers.map((item) => item.id === current.id ? { ...item, ...value } : item) })
    }
    const add = () => {
        const profile = blank()
        setConfig({ ...config, providers: [...config.providers, profile], defaultProviderId: config.defaultProviderId ?? profile.id })
        setSelected(profile.id)
    }
    const remove = () => {
        if (!current || !confirm(`删除模型“${current.name}”？使用它的会话会回退到默认模型。`)) return
        const providers = config.providers.filter((item) => item.id !== current.id)
        setConfig({
            ...config, providers,
            defaultProviderId: config.defaultProviderId === current.id ? providers[0]?.id ?? null : config.defaultProviderId,
            taskProviders: {
                summary: config.taskProviders.summary === current.id ? null : config.taskProviders.summary,
                memory: config.taskProviders.memory === current.id ? null : config.taskProviders.memory,
                vision: config.taskProviders.vision === current.id ? null : config.taskProviders.vision,
            },
        })
        setSelected(providers[0]?.id ?? null)
    }
    const test = async () => {
        if (!current) return
        setTesting(true); setTestResult('')
        try {
            await save()
            const result = await postJson<{ ok: boolean; model: string }>('/providers/test', { id: current.id })
            setTestResult(`连接成功：${result.model}`)
        } catch (reason) { setTestResult(reason instanceof Error ? reason.message : '连接失败') }
        finally { setTesting(false) }
    }
    return <div className="page-stack">
        <ErrorNotice message={error} />{notice && <div className="notice">{notice}</div>}
        <div className="editor-layout">
            <Panel title="模型配置" description="每套配置独立保存连接与能力声明。" actions={<Button variant="primary" onClick={add}>添加模型</Button>}>
                <div className="resource-list">
                    {config.providers.map((provider) => <button key={provider.id} className={`resource-row ${current?.id === provider.id ? 'selected' : ''}`} onClick={() => setSelected(provider.id)}>
                        <span><strong>{provider.name}</strong><small>{provider.model}</small></span><Badge>{provider.type}</Badge>
                    </button>)}
                    {!config.providers.length && <p className="muted">尚未配置模型。添加一套配置后即可开始。</p>}
                </div>
            </Panel>
            <div className="page-stack">
                {current && <Panel title="连接与模型" description="密钥只会写入本地配置，不会返回明文。">
                    <div className="form-grid">
                        <Field label="配置名称"><Input value={current.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
                        <Field label="协议"><Select value={current.type} onChange={(e) => patch({ type: e.target.value as ProviderType })}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option></Select></Field>
                        {current.type === 'google'
                            ? <GoogleModelField key={current.id} profile={current} onPatch={patch} />
                            : <Field label="模型名称" wide><Input value={current.model} onChange={(e) => patch({ model: e.target.value })} placeholder="例如 gpt-4o-mini / claude-sonnet-4-5" /></Field>}
                        {current.type === 'google' ? <details className="field-wide">
                            <summary>高级：自定义兼容服务端点（可选）</summary>
                            <Field label="API 地址" hint="官方 Gemini API 无需填写。仅在明确使用代理时填写 v1beta 协议根地址。"><Input value={current.baseUrl ?? ''} onChange={(e) => patch({ baseUrl: e.target.value })} /></Field>
                        </details> : <Field label="API 地址" hint="填写协议根地址；留空使用官方默认值。" wide><Input value={current.baseUrl ?? ''} onChange={(e) => patch({ baseUrl: e.target.value })} /></Field>}
                        <Field label="API 密钥" wide><Input type="password" value={current.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} autoComplete="new-password" /></Field>
                        <Field label="实际上下文上限"><NumberInput value={current.contextWindow} onChange={(e) => patch({ contextWindow: Number(e.target.value) })} /></Field>
                        <Field label="最大输出 token"><NumberInput value={current.maxOutputTokens} onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) })} /></Field>
                        <Field label="温度"><NumberInput min="0" max="2" step="0.1" value={current.temperature} onChange={(e) => patch({ temperature: Number(e.target.value) })} /></Field>
                    </div>
                    <Toggle checked={current.vision} onChange={(vision) => patch({ vision })} label="支持图片理解" />
                    <Toggle checked={current.toolCalling} onChange={(toolCalling) => patch({ toolCalling })} label="支持工具调用" />
                    <Toggle checked={current.structuredOutput} onChange={(structuredOutput) => patch({ structuredOutput })} label="支持原生结构化输出" />
                </Panel>}
                <Panel title="模型分配" description="辅助任务留空时继承当前会话的聊天模型。">
                    <div className="form-grid">
                        <Field label="全局默认聊天模型"><ProviderSelect value={config.defaultProviderId} providers={config.providers} onChange={(defaultProviderId) => setConfig({ ...config, defaultProviderId })} /></Field>
                        <Field label="历史摘要模型"><ProviderSelect nullable value={config.taskProviders.summary} providers={config.providers} onChange={(summary) => setConfig({ ...config, taskProviders: { ...config.taskProviders, summary } })} /></Field>
                        <Field label="记忆提取模型"><ProviderSelect nullable value={config.taskProviders.memory} providers={config.providers} onChange={(memory) => setConfig({ ...config, taskProviders: { ...config.taskProviders, memory } })} /></Field>
                        <Field label="图片理解模型"><ProviderSelect nullable value={config.taskProviders.vision} providers={config.providers} onChange={(vision) => setConfig({ ...config, taskProviders: { ...config.taskProviders, vision } })} /></Field>
                    </div>
                </Panel>
            </div>
        </div>
        {testResult && <div className="notice">{testResult}</div>}
        <div className="sticky-save">
            {current && <Button variant="danger" onClick={remove}>删除当前模型</Button>}
            {current && <Button disabled={testing} onClick={() => void test()}>{testing ? '正在测试' : '保存并测试连接'}</Button>}
            <Button variant="primary" disabled={saving} onClick={() => void save()}>保存模型配置</Button>
        </div>
    </div>
}

function ProviderSelect({ value, providers, onChange, nullable = false }: {
    value: string | null; providers: ProviderProfile[]; onChange: (value: string | null) => void; nullable?: boolean
}) {
    return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {nullable && <option value="">继承聊天模型</option>}
        {!nullable && !value && <option value="">请选择默认模型</option>}
        {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </Select>
}
