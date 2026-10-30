import { useCallback, useEffect, useState } from 'react'
import { apiData } from '../utils/api'

export function useResource<T>(path: string, dependencies: unknown[] = []) {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const refresh = useCallback(async () => {
        setLoading(true)
        try {
            setData(await apiData<T>(path))
            setError('')
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : '加载失败')
        } finally { setLoading(false) }
    }, [path])
    useEffect(() => { void refresh() }, [refresh, ...dependencies])
    return { data, setData, loading, error, refresh }
}
