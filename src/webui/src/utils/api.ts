import type { ApiResponse } from '../types'

function resolvePluginName(): string {
    if (window.__PLUGIN_NAME__) return window.__PLUGIN_NAME__
    try {
        const parentName = (window.parent as Window & { __PLUGIN_NAME__?: string }).__PLUGIN_NAME__
        if (parentName) return parentName
    } catch { /* cross-origin parent */ }
    const match = location.pathname.match(/\/(?:ext|plugin)\/([^/]+)/)
    return match?.[1] ?? 'napcat-plugin-ai-chat'
}

const API_BASE = '/api/Plugin/ext/' + resolvePluginName()

function token(): string {
    try {
        const local = localStorage.getItem('token')
        if (local) return local
    } catch { /* try parent */ }
    try { return window.parent.localStorage.getItem('token') || '' } catch { return '' }
}

export async function authFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const response = await fetch(new URL(API_BASE + path, window.location.origin), {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
            ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        },
    })
    const text = await response.text()
    let payload: ApiResponse<T>
    try { payload = JSON.parse(text) } catch { throw new Error(`请求失败（HTTP ${response.status}）`) }
    if (!response.ok || payload.code !== 0) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
    return payload
}

export async function apiData<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await authFetch<T>(path, options)
    return response.data as T
}

export const postJson = <T>(path: string, body: unknown): Promise<T> => apiData<T>(path, { method: 'POST', body: JSON.stringify(body) })
