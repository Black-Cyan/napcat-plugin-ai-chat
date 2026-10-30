import { useCallback, useEffect, useRef, useState } from 'react'
import type { GoogleModelDiscovery, ProviderProfile } from '../types'
import { postJson } from '../utils/api'
import { Button, ErrorNotice, Field, Select } from './ui'

export default function GoogleModelField({ profile, onPatch }: {
    profile: ProviderProfile
    onPatch: (patch: Partial<ProviderProfile>) => void
}) {
    const [result, setResult] = useState<GoogleModelDiscovery | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const requestId = useRef(0)

    const load = useCallback(async (refresh: boolean) => {
        const id = ++requestId.current
        if (!profile.apiKey) {
            setResult(null)
            setError('')
            setLoading(false)
            return
        }
        setLoading(true)
        setError('')
        try {
            const discovery = await postJson<GoogleModelDiscovery>('/providers/models', {
                id: profile.id,
                apiKey: profile.apiKey,
                baseUrl: profile.baseUrl,
                refresh,
            })
            if (id !== requestId.current) return
            setResult(discovery)
            if (!profile.model && discovery.models.length) {
                const model = discovery.models[0]
                onPatch({
                    model: model.baseModelId,
                    ...(model.inputTokenLimit > 0 ? { contextWindow: model.inputTokenLimit } : {}),
                    ...(model.outputTokenLimit > 0 ? { maxOutputTokens: model.outputTokenLimit } : {}),
                })
            }
        } catch (reason) {
            if (id === requestId.current) setError(reason instanceof Error ? reason.message : '模型列表获取失败')
        } finally {
            if (id === requestId.current) setLoading(false)
        }
    }, [profile.id, profile.apiKey, profile.baseUrl])

    useEffect(() => {
        setResult(null)
        const timeout = setTimeout(() => void load(false), 450)
        return () => {
            clearTimeout(timeout)
            requestId.current += 1
        }
    }, [load])

    const models = result?.models ?? []
    const currentId = profile.model.replace(/^models\//, '')
    const currentExists = models.some((model) => model.baseModelId === currentId || model.name === profile.model)
    return <div className="field-wide">
        <Field label="Gemini 模型" hint="模型来自 Google 官方列表，仅包含支持 generateContent 的模型；空选择时使用返回顺序中的第一个可用模型。">
            <Select
                value={currentExists ? models.find((model) => model.baseModelId === currentId || model.name === profile.model)?.baseModelId ?? profile.model : profile.model}
                disabled={loading || !profile.apiKey || !models.length}
                onChange={(event) => {
                    const model = models.find((item) => item.baseModelId === event.target.value)
                    if (!model) return
                    onPatch({
                        model: model.baseModelId,
                        ...(model.inputTokenLimit > 0 ? { contextWindow: model.inputTokenLimit } : {}),
                        ...(model.outputTokenLimit > 0 ? { maxOutputTokens: model.outputTokenLimit } : {}),
                    })
                }}
            >
                {!profile.apiKey && <option value="">请先填写 Google API Key</option>}
                {profile.apiKey && loading && !models.length && <option value="">正在获取模型列表…</option>}
                {!loading && !models.length && <option value="">没有可用模型</option>}
                {profile.model && !currentExists && <option value={profile.model}>当前配置不可用：{profile.model}</option>}
                {models.map((model) => <option key={model.name} value={model.baseModelId}>
                    {model.displayName}（{model.baseModelId}）
                </option>)}
            </Select>
        </Field>
        <div className="button-row">
            <Button disabled={loading || !profile.apiKey} onClick={() => void load(true)}>{loading ? '正在刷新' : '刷新模型列表'}</Button>
            {result && <small className="muted">
                {result.cached ? '使用缓存' : '已从 Google 更新'} · {new Date(result.fetchedAt).toLocaleTimeString()}
            </small>}
        </div>
        {result?.stale && <div className="notice">刷新失败，正在使用上次成功的模型列表。{result.error ? ` ${result.error}` : ''}</div>}
        {error && <ErrorNotice message={error} />}
        {result && !models.length && <div className="notice">Google 返回了空模型列表，或当前账号没有支持 generateContent 的模型。请检查 API 权限，不会自动选择其他模型。</div>}
        {profile.model && !currentExists && result && <div className="notice">当前保存的模型不在可用列表中。请手动选择替代模型，插件不会静默切换。</div>}
    </div>
}
