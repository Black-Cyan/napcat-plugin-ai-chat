import { useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { postJson } from '../utils/api'
import type { ProviderProfile, ProviderType } from '../types'
import { Notice, Badge, Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Select, Toggle } from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'
import GoogleModelField from '../components/GoogleModelField'
import { autoUsageLabels, capabilitiesOf, isSpeechOnly } from '../utils/capabilities'

const blank = (): ProviderProfile => ({
    id: crypto.randomUUID(), name: '新模型', type: 'openai', model: '', apiKey: '', baseUrl: '',
    contextWindow: 128000, maxOutputTokens: 4096, temperature: 0.7,
    vision: false, toolCalling: true, structuredOutput: true, tts: false, speechRecognition: false,
})

export default function ProvidersPage() {
    const { config, setConfig, saving, error, notice, save } = useConfig()
    const ask = useConfirm()
    const [selected, setSelected] = useState<string | null>(null)
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState('')
    if (!config) return <><ErrorNotice message={error} /><Loading label="正在读取模型配置" /></>
    const current = config.providers.find((item) => item.id === selected) ?? null
    const patch = (value: Partial<ProviderProfile>) => {
        if (!current) return
        setConfig({ ...config, providers: config.providers.map((item) => item.id === current.id ? { ...item, ...value } : item) })
    }
    const add = () => {
        const profile = blank()
        setConfig({ ...config, providers: [...config.providers, profile], defaultProviderId: config.defaultProviderId ?? profile.id })
        setSelected(profile.id)
    }
    const remove = async (profile: ProviderProfile) => {
        if (!await ask({ title: `删除模型“${profile.name}”？`, description: '使用它的会话会回退到默认模型，相关任务槽位会被清空。' })) return
        const providers = config.providers.filter((item) => item.id !== profile.id)
        setConfig({
            ...config, providers,
            defaultProviderId: config.defaultProviderId === profile.id ? providers[0]?.id ?? null : config.defaultProviderId,
            taskProviders: {
                summary: config.taskProviders.summary === profile.id ? null : config.taskProviders.summary,
                memory: config.taskProviders.memory === profile.id ? null : config.taskProviders.memory,
                vision: config.taskProviders.vision === profile.id ? null : config.taskProviders.vision,
                tts: config.taskProviders.tts === profile.id ? null : config.taskProviders.tts,
                speech: config.taskProviders.speech === profile.id ? null : config.taskProviders.speech,
            },
        })
        setSelected(null)
    }
    const test = async (profile: ProviderProfile) => {
        setTesting(true); setTestResult('')
        try {
            await save()
            const result = await postJson<{ ok: boolean; model: string }>('/providers/test', { id: profile.id })
            setTestResult(`连接成功：${result.model}`)
        } catch (reason) { setTestResult(reason instanceof Error ? reason.message : '连接失败') }
        finally { setTesting(false) }
    }
    return <div className="page-stack">
        <ErrorNotice message={error} /><Notice message={notice} />
        <Panel title="模型配置" description="点右侧三点配置、测试或删除。" actions={<Button variant="primary" onClick={add}>添加模型</Button>}>
            <div className="resource-list">
                {config.providers.map((provider) => <div key={provider.id} className={`resource-row object-row ${current?.id === provider.id ? 'selected' : ''}`}>
                    <button type="button" className="object-main resource-row-button" onClick={() => setSelected(provider.id)}>
                        <strong>{provider.name}</strong><small>{provider.model || '未填写模型名'}</small>
                    </button>
                    <Badge>{provider.type}</Badge>
                    <PopoverMenu actions={[
                        { label: '配置', onSelect: () => setSelected(provider.id) },
                        { label: testing ? '正在测试' : '保存并测试连接', onSelect: () => void test(provider), disabled: testing },
                        { label: '删除', danger: true, onSelect: () => void remove(provider) },
                    ]} />
                </div>)}
                {!config.providers.length && <p className="muted">尚未配置模型。添加一套配置后即可开始。</p>}
            </div>
        </Panel>
        <Panel title="模型分配" description="辅助任务留空时继承当前会话的聊天模型。">
            <div className="form-grid">
                <Field label="全局默认聊天模型"><ProviderSelect excludeTts value={config.defaultProviderId} providers={config.providers} onChange={(defaultProviderId) => setConfig({ ...config, defaultProviderId })} /></Field>
                <Field label="历史摘要模型"><ProviderSelect excludeTts nullable value={config.taskProviders.summary} providers={config.providers} onChange={(summary) => setConfig({ ...config, taskProviders: { ...config.taskProviders, summary } })} /></Field>
                <Field label="记忆提取模型"><ProviderSelect excludeTts nullable value={config.taskProviders.memory} providers={config.providers} onChange={(memory) => setConfig({ ...config, taskProviders: { ...config.taskProviders, memory } })} /></Field>
                <Field label="图片理解模型"><ProviderSelect excludeTts nullable value={config.taskProviders.vision} providers={config.providers} onChange={(vision) => setConfig({ ...config, taskProviders: { ...config.taskProviders, vision } })} /></Field>
                <Field label="语音合成（TTS）模型" hint="请选择 Gemini TTS 系列或 OpenAI 语音模型；TTS 模型不能再作为聊天/视觉模型。"><ProviderSelect nullable value={config.taskProviders.tts} providers={config.providers} onChange={(tts) => setConfig({ ...config, taskProviders: { ...config.taskProviders, tts } })} /></Field>
                <Field label="语音转写模型"><ProviderSelect excludeTts nullable value={config.taskProviders.speech} providers={config.providers} onChange={(speech) => setConfig({ ...config, taskProviders: { ...config.taskProviders, speech } })} /></Field>
            </div>
        </Panel>
        <Notice message={testResult} />
        <div className="sticky-save">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>保存模型配置</Button>
        </div>

        {current && <SidePanel
            title={current.name || '模型配置'}
            subtitle={`${current.type} · ${current.model || '未填写模型名'}`}
            onClose={() => setSelected(null)}
            footer={<>
                <Button variant="danger" onClick={() => void remove(current)}>删除</Button>
                <div className="flex items-center gap-2">
                    <Button disabled={testing} onClick={() => void test(current)}>{testing ? '正在测试' : '保存并测试'}</Button>
                    <Button variant="primary" disabled={saving} onClick={() => void save()}>保存</Button>
                </div>
            </>}
        >
            <div className="form-section">
                <h4 className="form-section-title">连接</h4>
                <div className="form-grid">
                    <Field label="配置名称"><Input value={current.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
                    <Field label="协议" hint="协议决定可用能力与表单字段；Fish Audio 仅用于语音合成与转写。">
                        <Select value={current.type} onChange={(e) => {
                            const type = e.target.value as ProviderType
                            if (type === 'fishaudio') {
                                patch({ type, model: current.model.startsWith('s') || current.model === 'drama-3' ? current.model : 's2.1-pro', sttModel: current.sttModel ?? 'transcribe-1-pro', tts: false, speechRecognition: false })
                            } else patch({ type })
                        }}>
                            <option value="openai">OpenAI 兼容</option>
                            <option value="anthropic">Anthropic</option>
                            <option value="google">Google Gemini</option>
                            <option value="fishaudio">Fish Audio</option>
                        </Select>
                    </Field>
                    {current.type !== 'google' && <Field label="API 地址" hint={current.type === 'fishaudio' ? '留空使用 api.fish.audio。' : '留空使用官方默认地址。'} wide>
                        <Input value={current.baseUrl ?? ''} onChange={(e) => patch({ baseUrl: e.target.value })} />
                    </Field>}
                    <Field label="API 密钥" hint="仅写入本地配置，读取接口不返回明文。" wide>
                        <Input type="password" value={current.apiKey} onChange={(e) => patch({ apiKey: e.target.value })} autoComplete="new-password" />
                    </Field>
                </div>
            </div>

            <div className="form-section">
                <h4 className="form-section-title">模型</h4>
                <div className="form-grid">
                    {current.type === 'google' && <GoogleModelField key={current.id} profile={current} onPatch={patch} />}
                    {current.type !== 'google' && current.type !== 'fishaudio' && <Field label="模型名称" hint="按名称自动识别语音模型，例如 tts-1、whisper-1。" wide>
                        <Input value={current.model} onChange={(e) => patch({ model: e.target.value })} placeholder="例如 gpt-4o-mini / claude-sonnet-4-5" />
                    </Field>}
                    {current.type === 'fishaudio' && <>
                        <Field label="模型" hint="合成与转写模型共用同一字段，按模型类别自动判定用途。" wide>
                            <Select value={current.model} onChange={(e) => patch({ model: e.target.value })}>
                                <optgroup label="语音合成">
                                    <option value="s2.1-pro">s2.1-pro</option>
                                    <option value="s2.1-pro-free">s2.1-pro-free（免费档）</option>
                                    <option value="drama-3">drama-3</option>
                                    <option value="s2-pro">s2-pro</option>
                                    <option value="s1">s1</option>
                                </optgroup>
                                <optgroup label="语音转写">
                                    <option value="transcribe-1-pro">transcribe-1-pro</option>
                                    <option value="transcribe-1">transcribe-1</option>
                                </optgroup>
                            </Select>
                        </Field>
                    </>}
                    {current.type === 'google' && <details className="field-wide">
                        <summary>自定义兼容服务端点</summary>
                        <Field label="API 地址" hint="仅在明确使用代理时填写 v1beta 协议根地址。"><Input value={current.baseUrl ?? ''} onChange={(e) => patch({ baseUrl: e.target.value })} /></Field>
                    </details>}
                    {current.type !== 'fishaudio' && <>
                        <Field label="实际上下文上限" hint="仅用于计算上下文预算。"><NumberInput value={current.contextWindow} onChange={(e) => patch({ contextWindow: Number(e.target.value) })} /></Field>
                        <Field label="最大输出 token"><NumberInput value={current.maxOutputTokens} onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) })} /></Field>
                        <Field label="温度"><NumberInput min="0" max="2" step="0.1" value={current.temperature} onChange={(e) => patch({ temperature: Number(e.target.value) })} /></Field>
                    </>}
                </div>
                {autoUsageLabels(current).length > 0 && <div className="usage-badges">
                    {autoUsageLabels(current).map((label) => <Badge key={label} tone="neutral">{label}</Badge>)}
                </div>}
            </div>

            {((current.type === 'fishaudio' && !current.model.startsWith('transcribe')) || (current.type !== 'fishaudio' && current.tts)) && <div className="form-section">
                <h4 className="form-section-title">语音参数</h4>
                <div className="form-grid">
                    <Field
                        label={current.type === 'fishaudio' ? '音色 reference_id' : '音色（voice）'}
                        hint={current.type === 'fishaudio' ? 'Fish Audio 声音模型 ID，留空使用默认音色。' : '留空用供应商默认：OpenAI alloy，Gemini Kore。'}
                    >
                        <Input value={current.ttsVoice ?? ''} onChange={(e) => patch({ ttsVoice: e.target.value })} placeholder={current.type === 'fishaudio' ? 'model-id' : 'alloy / Kore'} />
                    </Field>
                    <Field label="语速" hint={current.type === 'fishaudio' ? '映射 prosody.speed，1 为原速。' : '1 为原速。'}>
                        <NumberInput min="0.25" max="4" step="0.05" value={current.ttsSpeed ?? 1} onChange={(e) => patch({ ttsSpeed: Number(e.target.value) })} />
                    </Field>
                </div>
            </div>}

            {current.type !== 'fishaudio' && <details className="form-section advanced-overrides">
                <summary>高级覆盖（能力声明通常无需修改）</summary>
                <Toggle checked={current.vision} onChange={(vision) => patch({ vision })} label="支持图片理解" hint="允许把图片直接内联给该模型；关闭时改用视觉任务模型转述。" />
                <Toggle checked={current.toolCalling} onChange={(toolCalling) => patch({ toolCalling })} label="支持工具调用" hint="控制是否在请求中声明工具，关闭后不再提供拍一拍之外的全部工具。" />
                <Toggle checked={current.structuredOutput} onChange={(structuredOutput) => patch({ structuredOutput })} label="支持原生结构化输出" hint="是否使用供应商的 JSON Schema 响应约束，关闭后退回文本解析。" />
                <Toggle checked={current.tts} onChange={(tts) => patch({ tts })} label="声明为 TTS 语音合成模型" hint="手动覆盖自动识别；开启后该配置不能再作为聊天或视觉模型。" />
                <Toggle checked={current.speechRecognition} onChange={(speechRecognition) => patch({ speechRecognition })} label="声明为语音理解（转写）模型" hint="手动覆盖自动识别，用于接收音频并输出转写文本。" />
                {(current.tts || current.speechRecognition) && current.type === 'anthropic' && <p className="muted">Anthropic 没有音频接口，请改用其他协议。</p>}
            </details>}
        </SidePanel>}
    </div>
}

function ProviderSelect({ value, providers, onChange, nullable = false, excludeTts = false }: {
    value: string | null; providers: ProviderProfile[]; onChange: (value: string | null) => void; nullable?: boolean; excludeTts?: boolean
}) {
    const options = excludeTts ? providers.filter((provider) => !isSpeechOnly(provider)) : providers
    return <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {nullable && <option value="">继承聊天模型</option>}
        {!nullable && !value && <option value="">请选择默认模型</option>}
        {options.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </Select>
}
