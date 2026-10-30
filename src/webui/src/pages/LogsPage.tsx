import { useMemo, useState } from 'react'
import { useResource } from '../hooks/useResource'
import { useConfig } from '../hooks/useConfig'
import { postJson } from '../utils/api'
import type { LogEntry } from '../types'
import { Badge, Button, ErrorNotice, Input, Loading, Panel } from '../components/ui'
import { IconClock, IconDownload, IconRefresh, IconSearch, IconTerminal } from '../components/icons'

type LevelType = 'all' | 'debug' | 'info' | 'warn' | 'error'
type CategoryType = 'all' | 'chat' | 'model' | 'tool' | 'access' | 'system'

export default function LogsPage() {
    const { data, loading, error, refresh } = useResource<LogEntry[]>('/logs')
    const { config, save } = useConfig()
    const [levelFilter, setLevelFilter] = useState<LevelType>('all')
    const [categoryFilter, setCategoryFilter] = useState<CategoryType>('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
    const [copiedId, setCopiedId] = useState<number | null>(null)
    const [notice, setNotice] = useState('')

    const logs = data || []
    const isDebugOn = config?.debug ?? false

    const clearLogs = async () => {
        if (!confirm('清空当前内存中的所有运行日志？')) return
        await postJson('/logs/clear', {})
        setNotice('日志已清空')
        await refresh()
    }

    const toggleDebugMode = async () => {
        if (!config) return
        const nextDebug = !config.debug
        const ok = await save({ ...config, debug: nextDebug })
        if (ok) {
            setNotice(nextDebug ? 'Debug 全链路诊断模式已开启，将记录完整请求与原始数据。' : 'Debug 模式已关闭。')
            await refresh()
        }
    }

    const copyDetailsJson = (id: number, details: unknown) => {
        try {
            const str = JSON.stringify(details, null, 2)
            void navigator.clipboard.writeText(str)
            setCopiedId(id)
            setTimeout(() => setCopiedId(null), 2000)
        } catch {
            // ignore
        }
    }

    const toggleExpand = (id: number) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const exportLogsAsText = () => {
        if (!logs.length) return
        const lines = logs.map((entry) => {
            const time = new Date(entry.time).toISOString()
            const cat = entry.category ? `[${entry.category}] ` : ''
            const det = entry.details ? `\nPayload: ${JSON.stringify(entry.details, null, 2)}` : ''
            return `[${time}] [${entry.level.toUpperCase()}] ${cat}${entry.message}${det}`
        })
        const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `napcat-ai-chat-logs-${new Date().toISOString().slice(0, 10)}.log`
        a.click()
        URL.revokeObjectURL(url)
    }

    // Counts per level
    const counts = useMemo(() => {
        const res = { all: logs.length, debug: 0, info: 0, warn: 0, error: 0 }
        for (const log of logs) {
            if (log.level in res) res[log.level as keyof typeof res]++
        }
        return res
    }, [logs])

    // Filtered logs
    const filteredLogs = useMemo(() => {
        return logs.filter((entry) => {
            if (levelFilter !== 'all' && entry.level !== levelFilter) return false
            if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false
            if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase()
                const matchMsg = entry.message.toLowerCase().includes(q)
                const matchCat = entry.category?.toLowerCase().includes(q)
                let matchDet = false
                if (entry.details) {
                    try {
                        matchDet = JSON.stringify(entry.details).toLowerCase().includes(q)
                    } catch {
                        // ignore
                    }
                }
                if (!matchMsg && !matchCat && !matchDet) return false
            }
            return true
        })
    }, [logs, levelFilter, categoryFilter, searchQuery])

    return (
        <div className="page-stack">
            <ErrorNotice message={error} />
            {notice && <div className="notice">{notice}</div>}

            {/* Top Diagnostics Status Card */}
            <Panel
                title="运行与诊断控制台"
                description="集中监控机器人接收消息、大模型交互、工具调用及权限流转。敏感数据（API Key 与连接串）强制脱敏隐藏。"
                actions={
                    <div className="button-row" style={{ margin: 0 }}>
                        <Button
                            variant={isDebugOn ? 'primary' : 'secondary'}
                            onClick={() => void toggleDebugMode()}
                        >
                            {isDebugOn ? 'Debug 模式：运行中 (点击关闭)' : '开启 Debug 诊断模式'}
                        </Button>
                    </div>
                }
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 rounded-lg bg-surface-subtle border border-line flex items-center justify-between">
                        <div>
                            <span className="text-xs text-muted block">诊断捕获状态</span>
                            <strong className="text-sm font-semibold text-ink mt-0.5 block">
                                {isDebugOn ? '全链路捕获已激活' : '精简生产日志'}
                            </strong>
                        </div>
                        <Badge tone={isDebugOn ? 'good' : 'neutral'}>
                            {isDebugOn ? 'DEBUG ON' : 'STANDARD'}
                        </Badge>
                    </div>

                    <div className="p-3 rounded-lg bg-surface-subtle border border-line flex items-center justify-between">
                        <div>
                            <span className="text-xs text-muted block">内存日志容量</span>
                            <strong className="text-sm font-semibold text-ink mt-0.5 block">
                                {logs.length} / 500 条
                            </strong>
                        </div>
                        <IconTerminal size={18} className="text-muted" />
                    </div>

                    <div className="p-3 rounded-lg bg-surface-subtle border border-line flex items-center justify-between">
                        <div>
                            <span className="text-xs text-muted block">错误 / 异常事件</span>
                            <strong className={`text-sm font-semibold mt-0.5 block ${counts.error > 0 ? 'text-danger' : 'text-ink'}`}>
                                {counts.error} 次错误
                            </strong>
                        </div>
                        <Badge tone={counts.error > 0 ? 'danger' : 'good'}>
                            {counts.error > 0 ? '需关注' : '正常'}
                        </Badge>
                    </div>
                </div>
            </Panel>

            {/* Filter & Toolbar */}
            <Panel>
                <div className="flex flex-col gap-3">
                    {/* Top Row: Level tabs + Search */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        {/* Level Filter Pills */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                            {(['all', 'debug', 'info', 'warn', 'error'] as const).map((lvl) => {
                                const count = counts[lvl]
                                const isActive = levelFilter === lvl
                                return (
                                    <button
                                        key={lvl}
                                        type="button"
                                        className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors border ${
                                            isActive
                                                ? 'bg-accent text-white border-accent shadow-sm'
                                                : 'bg-surface text-muted border-line hover:bg-surface-subtle hover:text-ink'
                                        }`}
                                        onClick={() => setLevelFilter(lvl)}
                                    >
                                        {lvl === 'all'
                                            ? '全部'
                                            : lvl === 'debug'
                                            ? 'Debug'
                                            : lvl === 'info'
                                            ? 'Info'
                                            : lvl === 'warn'
                                            ? 'Warn'
                                            : 'Error'}{' '}
                                        <span className={`ml-1 text-[11px] opacity-80 ${isActive ? 'text-white' : 'text-muted'}`}>
                                            ({count})
                                        </span>
                                    </button>
                                )
                            })}
                        </div>

                        {/* Search Input */}
                        <div className="flex items-center gap-2 sm:max-w-xs flex-1">
                            <div className="relative w-full">
                                <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                                <Input
                                    value={searchQuery}
                                    placeholder="搜索日志消息、QQ号、Payload..."
                                    style={{ paddingLeft: '32px' }}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            {searchQuery && (
                                <Button variant="quiet" onClick={() => setSearchQuery('')}>
                                    清空
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Bottom Row: Category filters + Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-muted mr-1">分类:</span>
                            {(['all', 'chat', 'model', 'tool', 'access', 'system'] as const).map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                                        categoryFilter === cat
                                            ? 'bg-surface-subtle text-accent font-semibold underline'
                                            : 'text-muted hover:text-ink'
                                    }`}
                                    onClick={() => setCategoryFilter(cat)}
                                >
                                    {cat === 'all'
                                        ? '全部'
                                        : cat === 'chat'
                                        ? 'chat(对话)'
                                        : cat === 'model'
                                        ? 'model(模型)'
                                        : cat === 'tool'
                                        ? 'tool(工具)'
                                        : cat === 'access'
                                        ? 'access(权限)'
                                        : 'system(系统)'}
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                            <span className="text-muted text-xs">匹配 {filteredLogs.length} 条</span>
                            <Button onClick={() => void refresh()}>
                                <IconRefresh size={12} />
                                刷新
                            </Button>
                            <Button onClick={exportLogsAsText} disabled={!logs.length}>
                                <IconDownload size={12} />
                                导出
                            </Button>
                            <Button variant="danger" onClick={() => void clearLogs()}>
                                清空
                            </Button>
                        </div>
                    </div>
                </div>
            </Panel>

            {/* Log Stream Card */}
            <Panel title="实时事件流" description="按时间倒序排列。点击带有详细参数的条目可直接查看与复制结构化数据。">
                {loading && !data ? (
                    <Loading label="正在拉取日志记录..." />
                ) : (
                    <div className="log-console">
                        {filteredLogs.map((entry) => {
                            const isExpanded = expandedIds.has(entry.id)
                            const hasDetails = entry.details !== undefined

                            return (
                                <div
                                    key={entry.id}
                                    className={`log-row log-row-${entry.level} ${isExpanded ? 'is-expanded' : ''}`}
                                >
                                    {/* Main Row Header */}
                                    <div
                                        className={`log-row-main ${hasDetails ? 'cursor-pointer' : ''}`}
                                        onClick={() => {
                                            if (hasDetails) toggleExpand(entry.id)
                                        }}
                                    >
                                        <div className="log-row-header">
                                            <span className="log-time">
                                                <IconClock size={11} className="inline mr-1 text-muted" />
                                                {formatExactTime(entry.time)}
                                            </span>

                                            <Badge
                                                tone={
                                                    entry.level === 'error'
                                                        ? 'danger'
                                                        : entry.level === 'warn'
                                                        ? 'warn'
                                                        : entry.level === 'debug'
                                                        ? 'good'
                                                        : 'neutral'
                                                }
                                            >
                                                {entry.level.toUpperCase()}
                                            </Badge>

                                            {entry.category && (
                                                <span className="log-category-pill">
                                                    {entry.category}
                                                </span>
                                            )}

                                            {hasDetails && (
                                                <span className="log-expand-hint">
                                                    {isExpanded ? '收起详情 ▴' : '展开详情 ▾'}
                                                </span>
                                            )}
                                        </div>

                                        <div className="log-message">{entry.message}</div>
                                    </div>

                                    {/* Expanded Details Section */}
                                    {isExpanded && hasDetails && (
                                        <div className="log-details-drawer">
                                            <div className="log-details-header">
                                                <span className="font-semibold text-xs text-muted">
                                                    结构化数据 / 原始 Payload
                                                </span>
                                                <button
                                                    type="button"
                                                    className="log-copy-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        copyDetailsJson(entry.id, entry.details)
                                                    }}
                                                >
                                                    {copiedId === entry.id ? '✓ 已复制到剪贴板' : '复制 JSON'}
                                                </button>
                                            </div>
                                            <pre className="log-details-pre">
                                                {JSON.stringify(entry.details, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )
                        })}

                        {filteredLogs.length === 0 && (
                            <div className="empty py-12">
                                <IconTerminal size={28} className="text-muted opacity-40 mb-2" />
                                <strong>没有匹配的日志记录</strong>
                                <span className="text-xs text-muted">
                                    {logs.length === 0
                                        ? '当前暂无日志事件发生。'
                                        : '请尝试更改级别、分类或搜索关键词。'}
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </Panel>
        </div>
    )
}

function formatExactTime(ms: number): string {
    const d = new Date(ms)
    const pad = (n: number, z = 2) => String(n).padStart(z, '0')
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    const seconds = pad(d.getSeconds())
    const millis = pad(d.getMilliseconds(), 3)
    return `${hours}:${minutes}:${seconds}.${millis}`
}
