import { useState, useCallback } from 'react'
import { apiData } from '../utils/api'
import type { PluginStatus } from '../types'

export function useStatus() {
    const [status, setStatus] = useState<PluginStatus | null>(null)
    const fetchStatus = useCallback(async () => {
        try { setStatus(await apiData<PluginStatus>('/status')) } catch { /* retain last good status */ }
    }, [])
    return { status, fetchStatus }
}
