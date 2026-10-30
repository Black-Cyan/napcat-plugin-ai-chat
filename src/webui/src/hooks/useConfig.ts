import { useCallback, useEffect, useState } from 'react'
import { apiData, postJson } from '../utils/api'
import type { PluginConfig } from '../types'

export function useConfig() {
    const [config, setConfig] = useState<PluginConfig | null>(null)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const load = useCallback(async () => {
        try { setConfig(await apiData<PluginConfig>('/config')); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '配置加载失败') }
    }, [])
    useEffect(() => { void load() }, [load])
    const save = useCallback(async (next?: PluginConfig) => {
        const candidate = next ?? config
        if (!candidate) return false
        setSaving(true); setNotice('')
        try {
            const result = await postJson<{ config: PluginConfig; restartRequired: boolean }>('/config', candidate)
            setConfig(result.config)
            setNotice(result.restartRequired ? '已保存。重载插件后使用新的数据库。' : '配置已保存')
            setError('')
            return true
        } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); return false }
        finally { setSaving(false) }
    }, [config])
    return { config, setConfig, saving, error, notice, save, reload: load }
}
