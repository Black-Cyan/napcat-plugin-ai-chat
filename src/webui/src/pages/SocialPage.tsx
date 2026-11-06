import { useMemo, useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { useResource } from '../hooks/useResource'
import { postJson } from '../utils/api'
import { showToast } from '../hooks/useToast'
import type { SocialConfig, SocialEvent, SocialOverview, UserSocialRelation } from '../types'
import {
    Badge,
    Button,
    Empty,
    ErrorNotice,
    Field,
    Input,
    Loading,
    Notice,
    NumberInput,
    Panel,
    Toggle,
    UserAvatar,
} from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'
import {
    IconActivity,
    IconDashboard,
    IconGroup,
    IconHeart,
    IconLock,
    IconRefresh,
    IconScale,
    IconSliders,
    IconStar,
    IconTerminal,
} from '../components/icons'

type SocialTab = 'overview' | 'members' | 'events' | 'rules'

const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
    enabled: false,
    cooldownSeconds: 30,
    maxDailyExp: 20,
    maxDailyAffectionGain: 5,
    maxDailyAffectionLoss: 10,
    enableAiEvaluation: false,
    familiarityThresholds: [50, 120, 220, 350, 520, 740, 1020, 1380, 1850],
}

export default function SocialPage() {
    const { config, setConfig, saving, error: configError, notice, save } = useConfig()
    const [tab, setTab] = useState<SocialTab>('overview')

    if (!config) return <><ErrorNotice message={configError} /><Loading label="正在读取社交配置" /></>

    const socialConfig: SocialConfig = {
        ...DEFAULT_SOCIAL_CONFIG,
        ...(config.social ?? {}),
    }

    const isEnabled = Boolean(socialConfig.enabled)

    const toggleEnabled = async (enabled: boolean) => {
        const next = {
            ...config,
            social: { ...socialConfig, enabled },
        }
        setConfig(next)
        const ok = await save(next)
        if (ok) {
            showToast(enabled ? '社交系统已开启' : '社交系统已暂停', 'success')
        }
    }

    const patchSocial = (patchData: Partial<SocialConfig>) => {
        setConfig({
            ...config,
            social: { ...socialConfig, ...patchData },
        })
    }

    const handleSaveRules = async () => {
        const ok = await save()
        if (ok) {
            showToast('社交规则已保存', 'success')
        }
        return ok
    }

    return <div className="page-stack">
        <ErrorNotice message={configError} />
        <Notice message={notice} />

        {/* 顶部主卡片：包含总开关与 Tab 导航 */}
        <Panel
            title="社交关系"
            description="管理好感度与熟识度成长、风控规则与事件流水。"
            actions={<div className="flex items-center gap-3">
                <Badge tone={isEnabled ? 'good' : 'neutral'}>
                    {isEnabled ? '运行中' : '待机'}
                </Badge>
                <Toggle
                    checked={isEnabled}
                    onChange={(val) => void toggleEnabled(val)}
                    label="启用社交系统"
                />
            </div>}
        >
            <div className="tab-switcher">
                <button
                    type="button"
                    className={`tab-btn flex items-center gap-1.5 ${tab === 'overview' ? 'active' : ''}`}
                    onClick={() => setTab('overview')}
                >
                    <IconDashboard size={14} />
                    <span>总览看板</span>
                </button>
                <button
                    type="button"
                    className={`tab-btn flex items-center gap-1.5 ${tab === 'members' ? 'active' : ''}`}
                    onClick={() => setTab('members')}
                >
                    <IconGroup size={14} />
                    <span>成员列表</span>
                </button>
                <button
                    type="button"
                    className={`tab-btn flex items-center gap-1.5 ${tab === 'events' ? 'active' : ''}`}
                    onClick={() => setTab('events')}
                >
                    <IconTerminal size={14} />
                    <span>事件流水</span>
                </button>
                <button
                    type="button"
                    className={`tab-btn flex items-center gap-1.5 ${tab === 'rules' ? 'active' : ''}`}
                    onClick={() => setTab('rules')}
                >
                    <IconSliders size={14} />
                    <span>规则配置</span>
                </button>
            </div>
        </Panel>

        {/* 主内容区域：若系统待机且非规则页，展示锁止遮罩 */}
        <div className="social-content-wrapper">
            {!isEnabled && tab !== 'rules' && (
                <div className="social-lock-overlay">
                    <div className="social-lock-card">
                        <div className="social-lock-icon-wrapper">
                            <IconLock size={26} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <h3 className="text-base font-semibold text-ink">社交系统处于待机状态</h3>
                            <p className="text-xs text-muted max-w-sm leading-relaxed">
                                开启后开始记录成员的好感度与熟识度成长。
                            </p>
                        </div>
                        <Button variant="primary" onClick={() => void toggleEnabled(true)}>
                            启用社交系统
                        </Button>
                    </div>
                </div>
            )}

            {tab === 'overview' && <OverviewTab />}
            {tab === 'members' && <MembersTab />}
            {tab === 'events' && <EventsTab />}
            {tab === 'rules' && <RulesTab config={socialConfig} onChange={patchSocial} onSave={handleSaveRules} saving={saving} />}
        </div>
    </div>
}

// ==================== 1. 总览看板 (Overview) ====================

function OverviewTab() {
    const { data, loading, error, refresh } = useResource<SocialOverview>('/social/overview')

    if (loading && !data) return <Loading label="加载总览数据中..." />
    if (!data) return <ErrorNotice message={error || '无法读取总览数据'} />

    return <div className="page-stack">
        {/* 核心指标卡 */}
        <div className="metrics-grid">
            <div className="metric-card">
                <span className="metric-icon metric-icon-rose"><IconHeart size={20} /></span>
                <div>
                    <strong className="text-xl font-bold font-mono">{data.totalRelations}</strong>
                    <span className="text-xs text-muted block">建立关系成员</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon metric-icon-indigo"><IconScale size={20} /></span>
                <div>
                    <strong className="text-xl font-bold font-mono">{data.averageAffection > 0 ? `+${data.averageAffection}` : data.averageAffection}</strong>
                    <span className="text-xs text-muted block">平均好感度</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon metric-icon-amber"><IconStar size={20} /></span>
                <div>
                    <strong className="text-xl font-bold font-mono">{data.topFamiliarityCount}</strong>
                    <span className="text-xs text-muted block">熟识成员 (≥Lv5)</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon metric-icon-emerald"><IconActivity size={20} /></span>
                <div>
                    <strong className="text-xl font-bold font-mono">{data.todayEventsCount}</strong>
                    <span className="text-xs text-muted block">今日变动</span>
                </div>
            </div>
        </div>

        {/* 好感度与熟识度分布柱状图 */}
        <div className="two-column">
            <Panel title="好感度分布">
                <AffectionBarChart dist={data.affectionDistribution} />
            </Panel>

            <Panel title="熟识等级分布">
                <FamiliarityBarChart distribution={data.levelDistribution} total={data.totalRelations} />
            </Panel>
        </div>

        {/* 最近变动流水 */}
        <Panel
            title="最近变动"
            actions={<Button variant="quiet" className="flex items-center gap-1.5" onClick={() => void refresh()}>
                <IconRefresh size={14} />
                <span>刷新</span>
            </Button>}
        >
            <div className="event-stream">
                {data.recentEvents.map((e) => <EventRow key={e.id} event={e} />)}
                {data.recentEvents.length === 0 && <Empty title="暂无变动记录" description="" />}
            </div>
        </Panel>
    </div>
}

/** 好感度分布柱状图组件（带悬停数据显示） */
function AffectionBarChart({ dist }: { dist: SocialOverview['affectionDistribution'] }) {
    const [hovered, setHovered] = useState<number | null>(null)

    const items = useMemo(() => [
        { label: '崇拜', range: '80 ~ 100', count: dist.worship, color: 'var(--success)' },
        { label: '友好', range: '20 ~ 79', count: dist.friendly, color: 'color-mix(in srgb, var(--success) 60%, var(--accent))' },
        { label: '中立', range: '-19 ~ 19', count: dist.neutral, color: 'var(--muted)' },
        { label: '警惕', range: '-20 ~ -59', count: dist.wary, color: 'var(--warning)' },
        { label: '厌恶', range: '-60 ~ -100', count: dist.hostile, color: 'var(--danger)' },
    ], [dist])

    const total = items.reduce((sum, item) => sum + item.count, 0) || 1
    const maxCount = Math.max(...items.map((item) => item.count), 1)

    return (
        <div className="bar-chart-container">
            <div className="bar-chart-columns">
                {items.map((item, idx) => {
                    const heightPct = item.count > 0 ? Math.max(6, Math.round((item.count / maxCount) * 100)) : 0
                    const sharePct = Math.round((item.count / total) * 100)
                    const isHovered = hovered === idx

                    return (
                        <div
                            key={item.label}
                            className={`bar-chart-col ${isHovered ? 'active' : ''}`}
                            onMouseEnter={() => setHovered(idx)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            {isHovered && (
                                <div className="bar-chart-tooltip">
                                    <span className="bar-chart-tooltip-title">{item.label} ({item.range})</span>
                                    <span className="bar-chart-tooltip-value">{item.count} 人 · {sharePct}%</span>
                                </div>
                            )}
                            <div className="bar-chart-track">
                                <div
                                    className="bar-chart-fill"
                                    style={{
                                        height: `${heightPct}%`,
                                        background: item.color,
                                    }}
                                />
                            </div>
                            <span className="bar-chart-label">{item.label}</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/** 熟识等级梯队柱状图组件（带悬停数据显示） */
function FamiliarityBarChart({ distribution, total }: { distribution: Record<number, number>; total: number }) {
    const [hovered, setHovered] = useState<number | null>(null)

    const items = useMemo(() => Array.from({ length: 10 }, (_, i) => {
        const lvl = i + 1
        const count = distribution[lvl] ?? 0
        return {
            level: `Lv${lvl}`,
            count,
            color: `color-mix(in srgb, var(--accent) ${35 + i * 7}%, var(--surface-hover))`,
        }
    }), [distribution])

    const safeTotal = total || 1
    const maxCount = Math.max(...items.map((item) => item.count), 1)

    return (
        <div className="bar-chart-container">
            <div className="bar-chart-columns">
                {items.map((item, idx) => {
                    const heightPct = item.count > 0 ? Math.max(6, Math.round((item.count / maxCount) * 100)) : 0
                    const sharePct = Math.round((item.count / safeTotal) * 100)
                    const isHovered = hovered === idx

                    return (
                        <div
                            key={item.level}
                            className={`bar-chart-col ${isHovered ? 'active' : ''}`}
                            onMouseEnter={() => setHovered(idx)}
                            onMouseLeave={() => setHovered(null)}
                        >
                            {isHovered && (
                                <div className="bar-chart-tooltip">
                                    <span className="bar-chart-tooltip-title">熟识等级 {item.level}</span>
                                    <span className="bar-chart-tooltip-value">{item.count} 人 · {sharePct}%</span>
                                </div>
                            )}
                            <div className="bar-chart-track">
                                <div
                                    className="bar-chart-fill"
                                    style={{
                                        height: `${heightPct}%`,
                                        background: item.color,
                                    }}
                                />
                            </div>
                            <span className="bar-chart-label">{item.level}</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ==================== 2. 成员列表 (Members) ====================

function MembersTab() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<Array<UserSocialRelation & { externalId: string; displayName: string }>>(`/social/relations?search=${encodeURIComponent(search)}`)
    const [selectedUser, setSelectedUser] = useState<string | null>(null)
    const ask = useConfirm()

    const handleReset = async (item: UserSocialRelation & { externalId: string; displayName: string }) => {
        if (!await ask({
            title: `重置用户 ${item.displayName || item.externalId} 的关系数据？`,
            description: '好感度将重置为 0，熟识度恢复为 Lv1，该操作不可撤销。',
            confirmLabel: '确认重置',
        })) return
        try {
            await postJson(`/social/relations/${item.userId}/reset`, {})
            showToast('已重置该用户的社交关系', 'success')
            await refresh()
        } catch (reason) {
            showToast(reason instanceof Error ? reason.message : '重置失败', 'error')
        }
    }

    return <div className="page-stack">
        <Panel title="成员列表">
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索 QQ 号或昵称..."
                    />
                </div>
                {data && (
                    <span className="text-xs text-muted whitespace-nowrap font-mono">
                        共 {data.length} 位
                    </span>
                )}
            </div>
        </Panel>

        {loading && !data ? (
            <Loading label="加载成员列表中..." />
        ) : data && data.length > 0 ? (
            <div className="memory-users-grid">
                {data.map((item) => (
                    <div key={item.userId} className="memory-user-card object-row">
                        <UserAvatar qq={item.externalId} name={item.displayName} size={48} />
                        <button
                            type="button"
                            className="object-main resource-row-button text-left"
                            onClick={() => setSelectedUser(item.userId)}
                        >
                            <strong>{item.displayName || '未命名参与者'}</strong>
                            <span className="memory-user-qq text-xs text-muted font-mono">QQ {item.externalId}</span>
                            <div className="flex items-center gap-1.5 mt-1.5">
                                <Badge tone={item.affection > 0 ? 'good' : item.affection < 0 ? 'danger' : 'neutral'}>
                                    好感 {item.affection > 0 ? `+${item.affection}` : item.affection}
                                </Badge>
                                <Badge tone="neutral">
                                    熟识 Lv{item.familiarityLevel} ({item.familiarityExp} Exp)
                                </Badge>
                            </div>
                        </button>
                        <PopoverMenu actions={[
                            { label: '调整数值', onSelect: () => setSelectedUser(item.userId) },
                            { label: '重置数据', danger: true, onSelect: () => void handleReset(item) },
                        ]} />
                    </div>
                ))}
            </div>
        ) : (
            <Empty
                title={search ? '未找到匹配成员' : '暂无成员数据'}
                description=""
            />
        )}

        {selectedUser && (
            <MemberDetailPanel
                userId={selectedUser}
                onClose={() => setSelectedUser(null)}
                onChanged={refresh}
            />
        )}
    </div>
}

function MemberDetailPanel({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => Promise<void> }) {
    const { data, loading, error, refresh } = useResource<{
        relation: UserSocialRelation | null
        identity: { externalId: string } | null
        profile: { displayName?: string } | null
        events: SocialEvent[]
    }>(`/social/relations/${userId}`)

    const [affDelta, setAffDelta] = useState<number>(0)
    const [expDelta, setExpDelta] = useState<number>(0)
    const [reason, setReason] = useState('所有者手动调整')
    const [saving, setSaving] = useState(false)
    const ask = useConfirm()

    if (loading && !data) return <SidePanel title="成员档案" onClose={onClose}><Loading /></SidePanel>
    if (!data?.relation) return <SidePanel title="成员档案" onClose={onClose}><Empty title="未找到关系记录" description="" /></SidePanel>

    const rel = data.relation
    const qq = data.identity?.externalId ?? '未知'
    const name = data.profile?.displayName ?? '未命名参与者'

    // 计算好感度在标尺中的百分比 position (-100 ~ +100 -> 0% ~ 100%)
    const affPosition = Math.min(100, Math.max(0, ((rel.affection + 100) / 200) * 100))

    const handleSave = async () => {
        if (affDelta === 0 && expDelta === 0) {
            showToast('未做任何数值变动', 'info')
            return
        }
        setSaving(true)
        try {
            await postJson(`/social/relations/${userId}/adjust`, {
                affectionDelta: affDelta,
                expDelta: expDelta,
                reason: reason.trim() || '所有者手动调整',
            })
            showToast('已更新社交数值', 'success')
            setAffDelta(0)
            setExpDelta(0)
            await refresh()
            await onChanged()
        } catch (err) {
            showToast(err instanceof Error ? err.message : '保存失败', 'error')
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        if (!await ask({
            title: `重置用户 ${name} (${qq}) 的关系数据？`,
            description: '好感度将重置为 0，熟识度恢复为 Lv1，该操作不可撤销。',
            confirmLabel: '确认重置',
        })) return
        try {
            await postJson(`/social/relations/${userId}/reset`, {})
            showToast('已重置该用户的社交关系', 'success')
            await refresh()
            await onChanged()
            onClose()
        } catch (err) {
            showToast(err instanceof Error ? err.message : '重置失败', 'error')
        }
    }

    return <SidePanel
        title={name}
        subtitle={`QQ: ${qq}`}
        onClose={onClose}
        footer={<>
            <Button variant="danger" onClick={() => void handleReset()}>重置数据</Button>
            <div className="flex items-center gap-2">
                <Button variant="quiet" onClick={onClose}>取消</Button>
                <Button variant="primary" disabled={saving || (affDelta === 0 && expDelta === 0)} onClick={() => void handleSave()}>
                    {saving ? '正在保存' : '保存变动'}
                </Button>
            </div>
        </>}
    >
        {/* 用户头像与当前状态卡片 */}
        <div className="flex items-center gap-3.5 p-3.5 bg-surface-subtle border border-line-subtle rounded-2xl mb-4">
            <UserAvatar qq={qq} name={name} size={54} />
            <div className="flex-1 min-w-0">
                <strong className="block text-sm text-ink truncate">{name}</strong>
                <span className="text-xs text-muted font-mono">QQ: {qq}</span>
                <div className="flex gap-2 mt-1.5">
                    <Badge tone={rel.affection > 0 ? 'good' : rel.affection < 0 ? 'danger' : 'neutral'}>
                        好感 {rel.affection > 0 ? `+${rel.affection}` : rel.affection}
                    </Badge>
                    <Badge tone="neutral">
                        熟识 Lv{rel.familiarityLevel} ({rel.familiarityExp} Exp)
                    </Badge>
                </div>
            </div>
        </div>

        {/* 状态刻度标尺 */}
        <div className="flex flex-col gap-3 mb-4">
            <div className="affection-gauge">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-muted font-medium">好感度标尺</span>
                    <span className="font-mono font-bold text-ink">{rel.affection > 0 ? `+${rel.affection}` : rel.affection}</span>
                </div>
                <div className="affection-track">
                    <div className="affection-marker" style={{ left: `${affPosition}%` }} />
                </div>
                <div className="affection-scale-labels">
                    <span>-100</span>
                    <span>0</span>
                    <span>+100</span>
                </div>
            </div>
        </div>

        {/* 调分表单 */}
        <div className="form-section">
            <h4 className="form-section-title">调整数值</h4>
            <div className="form-grid">
                <Field label={`好感度增减 (${affDelta > 0 ? `+${affDelta}` : affDelta})`} hint="范围 -100 ~ +100">
                    <NumberInput value={affDelta} onChange={(e) => setAffDelta(Number(e.target.value) || 0)} />
                    <div className="flex gap-1.5 mt-2">
                        {[-10, -5, +5, +10].map((d) => (
                            <button
                                key={d}
                                type="button"
                                className={`quick-chip ${affDelta === d ? 'active' : ''}`}
                                onClick={() => setAffDelta(d)}
                            >
                                {d > 0 ? `+${d}` : d}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={`熟识经验增量 (+${expDelta})`} hint="累积经验值">
                    <NumberInput min="0" value={expDelta} onChange={(e) => setExpDelta(Math.max(0, Number(e.target.value) || 0))} />
                    <div className="flex gap-1.5 mt-2">
                        {[+10, +20, +50, +100].map((d) => (
                            <button
                                key={d}
                                type="button"
                                className={`quick-chip ${expDelta === d ? 'active' : ''}`}
                                onClick={() => setExpDelta(d)}
                            >
                                +{d}
                            </button>
                        ))}
                    </div>
                </Field>
            </div>

            <Field label="变动原因说明" wide>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：手动校准" />
            </Field>
        </div>

        {/* 该用户历史流水 */}
        <div className="mt-5">
            <h4 className="text-xs font-semibold text-muted mb-2.5">最近变动记录 ({data.events.length})</h4>
            <div className="flex flex-col gap-2">
                {data.events.map((e) => (
                    <div key={e.id} className="p-3 rounded-xl border border-line-subtle bg-surface-subtle text-xs">
                        <div className="flex justify-between items-center mb-1.5">
                            <span className="font-semibold text-ink">{e.reason}</span>
                            <span className="text-[11px] text-muted font-mono">{new Date(e.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                            {e.affectionDelta !== 0 && (
                                <span className={e.affectionDelta > 0 ? 'text-success font-semibold' : 'text-danger font-semibold'}>
                                    好感 {e.affectionDelta > 0 ? `+${e.affectionDelta}` : e.affectionDelta} → {e.affectionAfter}
                                </span>
                            )}
                            {e.expDelta !== 0 && (
                                <span className="text-accent font-semibold">
                                    经验 +{e.expDelta} → {e.expAfter}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                {data.events.length === 0 && <p className="text-xs text-muted p-2">暂无变动记录。</p>}
            </div>
        </div>
    </SidePanel>
}

// ==================== 3. 事件流水 (Events) ====================

function EventsTab() {
    const [eventType, setEventType] = useState<string>('all')
    const { data, loading, error, refresh } = useResource<SocialEvent[]>('/social/events?limit=100')

    const filtered = useMemo(() => {
        if (!data) return []
        if (eventType === 'all') return data
        return data.filter((e) => e.eventType === eventType)
    }, [data, eventType])

    return <div className="page-stack">
        <Panel
            title="事件流水"
            actions={<Button variant="quiet" className="flex items-center gap-1.5" onClick={() => void refresh()}>
                <IconRefresh size={14} />
                <span>刷新</span>
            </Button>}
        >
            <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                    { id: 'all', label: '全部' },
                    { id: 'chat_rule', label: '日常互动' },
                    { id: 'admin_adjust', label: '所有者调整' },
                    { id: 'admin_reset', label: '数据重置' },
                    { id: 'ai_eval', label: 'AI 评价' },
                ].map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`log-filter px-3 py-1.5 text-xs ${eventType === item.id ? 'active' : ''}`}
                        onClick={() => setEventType(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            {loading && !data ? (
                <Loading label="加载流水中..." />
            ) : filtered.length > 0 ? (
                <div className="event-stream">
                    {filtered.map((e) => <EventRow key={e.id} event={e} />)}
                </div>
            ) : (
                <Empty title="暂无记录" description="" />
            )}
        </Panel>
    </div>
}

function EventRow({ event }: { event: SocialEvent }) {
    const isAffGood = event.affectionDelta > 0
    const isAffBad = event.affectionDelta < 0

    return <div className="event-row panel p-3">
        <div className="flex items-center justify-between text-xs mb-1.5">
            <div className="flex items-center gap-2">
                <Badge tone={event.eventType.startsWith('admin') ? 'warn' : 'neutral'}>
                    {event.eventType === 'chat_rule' ? '日常互动' :
                     event.eventType === 'admin_adjust' ? '所有者调整' :
                     event.eventType === 'admin_reset' ? '数据重置' :
                     event.eventType === 'ai_eval' ? 'AI 评价' : event.eventType}
                </Badge>
                <span className="font-semibold text-ink">{event.reason}</span>
            </div>
            <span className="text-muted font-mono text-[11px]">{new Date(event.createdAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
            {event.affectionDelta !== 0 && (
                <span className={`font-mono font-semibold ${isAffGood ? 'text-success' : isAffBad ? 'text-danger' : 'text-muted'}`}>
                    好感 {event.affectionDelta > 0 ? `+${event.affectionDelta}` : event.affectionDelta} (当前: {event.affectionAfter})
                </span>
            )}
            {event.expDelta !== 0 && (
                <span className="font-mono text-accent font-semibold">
                    经验 +{event.expDelta} (总计: {event.expAfter})
                </span>
            )}
            <span className="text-muted ml-auto font-mono text-[11px]">
                用户: {event.userId.slice(0, 8)}...
            </span>
        </div>
    </div>
}

// ==================== 4. 规则配置 (Rules) ====================

function RulesTab({
    config,
    onChange,
    onSave,
    saving,
}: {
    config: SocialConfig
    onChange: (patch: Partial<SocialConfig>) => void
    onSave: () => Promise<boolean>
    saving: boolean
}) {
    const currentThresholds = config.familiarityThresholds || [50, 120, 220, 350, 520, 740, 1020, 1380, 1850]

    const updateThreshold = (index: number, val: number) => {
        const next = [...currentThresholds]
        next[index] = val
        onChange({ familiarityThresholds: next })
    }

    return <div className="page-stack">
        <Panel title="风控与上限">
            <div className="form-grid">
                <Field label="发言冷却时间（秒）" hint="冷却期内的多次发言不重复计算">
                    <NumberInput
                        min="0"
                        max="86400"
                        value={config.cooldownSeconds}
                        onChange={(e) => onChange({ cooldownSeconds: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日经验上限 (Exp)" hint="单人单日经验获取上限">
                    <NumberInput
                        min="0"
                        max="1000"
                        value={config.maxDailyExp}
                        onChange={(e) => onChange({ maxDailyExp: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日好感获取上限" hint="单人单日好感最大提升点数">
                    <NumberInput
                        min="0"
                        max="100"
                        value={config.maxDailyAffectionGain}
                        onChange={(e) => onChange({ maxDailyAffectionGain: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日好感最大跌幅" hint="单人单日好感最大扣减点数">
                    <NumberInput
                        min="0"
                        max="100"
                        value={config.maxDailyAffectionLoss}
                        onChange={(e) => onChange({ maxDailyAffectionLoss: Number(e.target.value) || 0 })}
                    />
                </Field>
            </div>
        </Panel>

        <Panel title="AI 态度评价">
            <Toggle
                checked={config.enableAiEvaluation}
                onChange={(enableAiEvaluation) => onChange({ enableAiEvaluation })}
                label="启用对话态度评价"
                hint="调用大模型判定发言态度倾向，受单日上限控制"
            />
        </Panel>

        <Panel title="等级经验门槛">
            <div className="thresholds-table">
                {currentThresholds.map((th, idx) => {
                    const prevTh = idx === 0 ? 0 : currentThresholds[idx - 1]
                    const delta = th - prevTh
                    return (
                        <div key={idx} className="threshold-row flex items-center justify-between p-2.5 border-b border-line-subtle text-xs">
                            <span className="font-semibold text-ink">Lv{idx + 2} 所需经验:</span>
                            <div className="flex items-center gap-2">
                                <span className="text-muted text-[11px] font-mono">+{delta}</span>
                                <NumberInput
                                    style={{ width: '120px' }}
                                    min="1"
                                    value={th}
                                    onChange={(e) => updateThreshold(idx, Number(e.target.value) || 1)}
                                />
                                <span className="text-muted font-mono">Exp</span>
                            </div>
                        </div>
                    )
                })}
            </div>
        </Panel>

        <div className="sticky-save">
            <Button variant="primary" disabled={saving} onClick={() => void onSave()}>
                {saving ? '正在保存' : '保存社交规则'}
            </Button>
        </div>
    </div>
}
