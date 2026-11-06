import { useMemo, useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { useResource } from '../hooks/useResource'
import { apiData, postJson } from '../utils/api'
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
    Select,
    Toggle,
} from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'
import { IconHeart } from '../components/icons'

type SocialTab = 'overview' | 'members' | 'events' | 'rules'

export default function SocialPage() {
    const { config, setConfig, saving, error: configError, notice, save } = useConfig()
    const [tab, setTab] = useState<SocialTab>('overview')

    const isEnabled = Boolean(config?.social?.enabled)

    const toggleEnabled = async (enabled: boolean) => {
        if (!config) return
        const next = {
            ...config,
            social: { ...config.social, enabled },
        }
        setConfig(next)
        const ok = await save(next)
        if (ok) {
            showToast(enabled ? '社交关系系统已启用' : '社交关系系统已停用，数据已安全保留', 'success')
        }
    }

    if (!config) return <><ErrorNotice message={configError} /><Loading label="正在读取社交配置" /></>

    return <div className="page-stack">
        <ErrorNotice message={configError} />
        <Notice message={notice} />

        {/* 顶部主卡片：包含总开关与 Tab 导航 */}
        <Panel
            title="社交关系"
            description="管理好感度与熟识度成长、防刷规则与事件审计。"
            actions={<div className="flex items-center gap-3">
                <Badge tone={isEnabled ? 'good' : 'warn'}>
                    {isEnabled ? '运行中' : '已停用'}
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
                    className={`tab-btn ${tab === 'overview' ? 'active' : ''}`}
                    onClick={() => setTab('overview')}
                >
                    总览看板
                </button>
                <button
                    type="button"
                    className={`tab-btn ${tab === 'members' ? 'active' : ''}`}
                    onClick={() => setTab('members')}
                >
                    成员关系
                </button>
                <button
                    type="button"
                    className={`tab-btn ${tab === 'events' ? 'active' : ''}`}
                    onClick={() => setTab('events')}
                >
                    互动流水
                </button>
                <button
                    type="button"
                    className={`tab-btn ${tab === 'rules' ? 'active' : ''}`}
                    onClick={() => setTab('rules')}
                >
                    规则配置
                </button>
            </div>
        </Panel>

        {/* 主内容区域：若系统停用且非规则页，展示细腻毛玻璃锁止遮罩 */}
        <div className="social-content-wrapper">
            {!isEnabled && tab !== 'rules' && (
                <div className="social-lock-overlay">
                    <div className="social-lock-card panel">
                        <div className="panel-body flex flex-col items-center gap-3 text-center py-6">
                            <span className="text-3xl">🔒</span>
                            <h3 className="text-base font-semibold">社交关系系统已停用</h3>
                            <p className="text-xs text-muted max-w-sm">
                                机器人当前不会根据发言产生好感度变动或记录互动流水，已有关系数据已妥善保留。您仍可在【规则配置】中预先调整参数。
                            </p>
                            <Button variant="primary" onClick={() => void toggleEnabled(true)}>
                                立即启用社交系统
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'overview' && <OverviewTab />}
            {tab === 'members' && <MembersTab />}
            {tab === 'events' && <EventsTab />}
            {tab === 'rules' && <RulesTab config={config.social} onSave={save} saving={saving} />}
        </div>
    </div>
}

// ==================== 1. 总览看板 (Overview) ====================

function OverviewTab() {
    const { data, loading, error, refresh } = useResource<SocialOverview>('/social/overview')

    if (loading && !data) return <Loading label="加载社交总览中..." />
    if (!data) return <ErrorNotice message={error || '无法读取总览数据'} />

    const dist = data.affectionDistribution
    const totalDist = (dist.worship + dist.friendly + dist.neutral + dist.wary + dist.hostile) || 1

    return <div className="page-stack">
        {/* 4 枚玻璃核心指标卡 */}
        <div className="metrics-grid">
            <div className="metric-card">
                <span className="metric-icon"><IconHeart size={20} /></span>
                <div>
                    <strong className="text-xl font-bold">{data.totalRelations}</strong>
                    <span className="text-xs text-muted block">关系建立人数</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon">⚖️</span>
                <div>
                    <strong className="text-xl font-bold">{data.averageAffection > 0 ? `+${data.averageAffection}` : data.averageAffection}</strong>
                    <span className="text-xs text-muted block">平均好感度</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon">⭐</span>
                <div>
                    <strong className="text-xl font-bold">{data.topFamiliarityCount}</strong>
                    <span className="text-xs text-muted block">深度熟识 (≥Lv5)</span>
                </div>
            </div>
            <div className="metric-card">
                <span className="metric-icon">⚡</span>
                <div>
                    <strong className="text-xl font-bold">{data.todayEventsCount}</strong>
                    <span className="text-xs text-muted block">今日互动结算</span>
                </div>
            </div>
        </div>

        {/* 好感度与熟识度分布 */}
        <div className="two-column">
            <Panel title="好感度分布" description="全局所有用户的感情倾向阶梯。">
                <div className="distribution-bars">
                    <DistBar label="崇拜 (80~100)" count={dist.worship} total={totalDist} tone="good" />
                    <DistBar label="友好 (20~79)" count={dist.friendly} total={totalDist} tone="good" />
                    <DistBar label="中立 (-19~19)" count={dist.neutral} total={totalDist} tone="neutral" />
                    <DistBar label="警惕 (-20~-59)" count={dist.wary} total={totalDist} tone="warn" />
                    <DistBar label="厌恶 (-60~-100)" count={dist.hostile} total={totalDist} tone="danger" />
                </div>
            </Panel>

            <Panel title="熟识等级分布" description="用户等级随日常发言累积经验自然攀升。">
                <div className="level-capsules-grid">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((lvl) => {
                        const count = data.levelDistribution[lvl] ?? 0
                        return (
                            <div key={lvl} className="level-capsule-item">
                                <span className="font-semibold text-xs">Lv{lvl}</span>
                                <span className="text-xs text-muted">{count} 人</span>
                            </div>
                        )
                    })}
                </div>
            </Panel>
        </div>

        {/* 最近变动流水 */}
        <Panel title="最近互动异动" description="记录系统规则结算与所有者调整的最新流水。" actions={<Button variant="quiet" onClick={() => void refresh()}>刷新</Button>}>
            <div className="event-stream">
                {data.recentEvents.map((e) => <EventRow key={e.id} event={e} />)}
                {data.recentEvents.length === 0 && <Empty title="暂无互动事件" description="当用户在群聊或私聊中与机器人对话时，会自动产生记录。" />}
            </div>
        </Panel>
    </div>
}

function DistBar({ label, count, total, tone }: { label: string; count: number; total: number; tone: 'good' | 'neutral' | 'warn' | 'danger' }) {
    const pct = Math.round((count / total) * 100)
    return <div className="dist-bar-row">
        <span className="dist-bar-label text-xs">{label}</span>
        <div className="dist-bar-track">
            <div className={`dist-bar-fill dist-bar-${tone}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="dist-bar-count text-xs font-mono">{count}人 ({pct}%)</span>
    </div>
}

// ==================== 2. 成员关系 (Members) ====================

function MembersTab() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<Array<UserSocialRelation & { externalId: string; displayName: string }>>(`/social/relations?search=${encodeURIComponent(search)}`)
    const [selectedUser, setSelectedUser] = useState<string | null>(null)
    const ask = useConfirm()

    const handleReset = async (item: UserSocialRelation & { externalId: string; displayName: string }) => {
        if (!await ask({
            title: `重置用户 ${item.displayName || item.externalId} 的关系数据？`,
            description: `将清空该用户的好感度（恢复为 0）与熟识经验（恢复为 Lv1），并写入审计流水。此操作不可逆。`,
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
        <Panel title="成员关系名册" description="支持按 QQ 号或昵称搜索，点右侧三点可快速微调或重置。">
            <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索成员 QQ 号或昵称..."
            />
        </Panel>

        {loading && !data ? (
            <Loading label="加载成员关系列表中..." />
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
                            <span className="memory-user-qq text-xs text-muted">QQ {item.externalId}</span>
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
                            { label: '调整关系', onSelect: () => setSelectedUser(item.userId) },
                            { label: '重置社交数据', danger: true, onSelect: () => void handleReset(item) },
                        ]} />
                    </div>
                ))}
            </div>
        ) : (
            <Empty
                title={search ? '未找到匹配的成员' : '暂无社交成员'}
                description={search ? '换一个 QQ 号或昵称试试。' : '当用户在对话中互动后，系统会自动为其建立关系档案。'}
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
            showToast('社交数值已更新并写入流水', 'success')
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
            description: '好感度与熟识经验将归零，此操作不可撤销。',
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
        subtitle={`QQ ${qq} · 内部ID: ${userId.slice(0, 8)}...`}
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
        {/* 用户大头像与当前状态卡片 */}
        <div className="flex items-center gap-3 p-3 bg-surface-subtle rounded-xl mb-3">
            <UserAvatar qq={qq} name={name} size={54} />
            <div>
                <strong className="block text-sm">{name}</strong>
                <span className="text-xs text-muted">QQ: {qq}</span>
                <div className="flex gap-2 mt-1">
                    <Badge tone={rel.affection > 0 ? 'good' : rel.affection < 0 ? 'danger' : 'neutral'}>
                        好感: {rel.affection > 0 ? `+${rel.affection}` : rel.affection}
                    </Badge>
                    <Badge tone="neutral">
                        熟识: Lv{rel.familiarityLevel} ({rel.familiarityExp} Exp)
                    </Badge>
                </div>
            </div>
        </div>

        {/* 调分表单 */}
        <div className="form-section">
            <h4 className="form-section-title">手动调整关系数值</h4>
            <div className="form-grid">
                <Field label={`好感度变动 (${affDelta > 0 ? `+${affDelta}` : affDelta})`} hint="输入整数，例如 +10 或 -5">
                    <NumberInput value={affDelta} onChange={(e) => setAffDelta(Number(e.target.value) || 0)} />
                    <div className="flex gap-1.5 mt-1.5">
                        {[-10, -5, +5, +10].map((d) => (
                            <button
                                key={d}
                                type="button"
                                className="px-2 py-0.5 text-xs rounded border border-line bg-surface hover:bg-surface-subtle"
                                onClick={() => setAffDelta(d)}
                            >
                                {d > 0 ? `+${d}` : d}
                            </button>
                        ))}
                    </div>
                </Field>

                <Field label={`熟识经验变动 (+${expDelta})`} hint="经验只增不减，系统自动重算等级">
                    <NumberInput min="0" value={expDelta} onChange={(e) => setExpDelta(Math.max(0, Number(e.target.value) || 0))} />
                    <div className="flex gap-1.5 mt-1.5">
                        {[+10, +20, +50, +100].map((d) => (
                            <button
                                key={d}
                                type="button"
                                className="px-2 py-0.5 text-xs rounded border border-line bg-surface hover:bg-surface-subtle"
                                onClick={() => setExpDelta(d)}
                            >
                                +{d}
                            </button>
                        ))}
                    </div>
                </Field>
            </div>

            <Field label="变动原因说明" hint="将记录于审计流水账本" wide>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：特殊答谢、误操作校准" />
            </Field>
        </div>

        {/* 该用户历史流水 */}
        <div className="mt-4">
            <h4 className="text-xs font-semibold text-muted mb-2">最近关系异动流水 ({data.events.length})</h4>
            <div className="flex flex-col gap-2">
                {data.events.map((e) => (
                    <div key={e.id} className="p-2.5 rounded-lg border border-line-subtle bg-surface-subtle text-xs">
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-ink">{e.reason}</span>
                            <span className="text-[11px] text-muted">{new Date(e.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex gap-2">
                            {e.affectionDelta !== 0 && (
                                <span className={e.affectionDelta > 0 ? 'text-success' : 'text-danger'}>
                                    好感 {e.affectionDelta > 0 ? `+${e.affectionDelta}` : e.affectionDelta} → {e.affectionAfter}
                                </span>
                            )}
                            {e.expDelta !== 0 && (
                                <span className="text-accent">
                                    经验 +{e.expDelta} → {e.expAfter}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
                {data.events.length === 0 && <p className="text-xs text-muted p-2">该用户暂无变动记录。</p>}
            </div>
        </div>
    </SidePanel>
}

// ==================== 3. 互动流水 (Events) ====================

function EventsTab() {
    const [eventType, setEventType] = useState<string>('all')
    const { data, loading, error, refresh } = useResource<SocialEvent[]>('/social/events?limit=100')

    const filtered = useMemo(() => {
        if (!data) return []
        if (eventType === 'all') return data
        return data.filter((e) => e.eventType === eventType)
    }, [data, eventType])

    return <div className="page-stack">
        <Panel title="互动流水账本" description="不可变流水审计记录。所有规则结算、AI打分与所有者调整均记录于此。" actions={<Button variant="quiet" onClick={() => void refresh()}>刷新</Button>}>
            <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                    { id: 'all', label: '全部' },
                    { id: 'chat_rule', label: '日常互动 (chat_rule)' },
                    { id: 'admin_adjust', label: '管理调整 (admin_adjust)' },
                    { id: 'admin_reset', label: '数据重置 (admin_reset)' },
                    { id: 'ai_eval', label: 'AI辅助评价 (ai_eval)' },
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
                <Empty title="暂无匹配流水" description="当前筛选条件下没有产生事件记录。" />
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
                    {event.eventType}
                </Badge>
                <span className="font-semibold text-ink">{event.reason}</span>
            </div>
            <span className="text-muted font-mono">{new Date(event.createdAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
            {event.affectionDelta !== 0 && (
                <span className={`font-mono font-semibold ${isAffGood ? 'text-success' : isAffBad ? 'text-danger' : 'text-muted'}`}>
                    好感 {event.affectionDelta > 0 ? `+${event.affectionDelta}` : event.affectionDelta} (当前: {event.affectionAfter})
                </span>
            )}
            {event.expDelta !== 0 && (
                <span className="font-mono text-accent">
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

function RulesTab({ config, onSave, saving }: { config: SocialConfig; onSave: () => Promise<boolean>; saving: boolean }) {
    const { config: fullConfig, setConfig } = useConfig()

    const patch = (patchData: Partial<SocialConfig>) => {
        if (!fullConfig) return
        setConfig({
            ...fullConfig,
            social: { ...fullConfig.social, ...patchData },
        })
    }

    const currentThresholds = config.familiarityThresholds || [50, 120, 220, 350, 520, 740, 1020, 1380, 1850]

    const updateThreshold = (index: number, val: number) => {
        const next = [...currentThresholds]
        next[index] = val
        patch({ familiarityThresholds: next })
    }

    return <div className="page-stack">
        <Panel title="防刷与风控参数" description="确定性规则引擎的前置防刷保护。">
            <div className="form-grid">
                <Field label="互动冷却时间（秒）" hint="同一用户在冷却期内的多次发言不重复计算熟识度经验与好感。">
                    <NumberInput
                        min="0"
                        max="86400"
                        value={config.cooldownSeconds}
                        onChange={(e) => patch({ cooldownSeconds: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日经验上限 (Exp)" hint="每个用户每天通过发言最多获得的熟识度经验值。">
                    <NumberInput
                        min="0"
                        max="1000"
                        value={config.maxDailyExp}
                        onChange={(e) => patch({ maxDailyExp: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日好感获取上限" hint="每日通过正面互动或AI评价最多提升的好感点数。">
                    <NumberInput
                        min="0"
                        max="100"
                        value={config.maxDailyAffectionGain}
                        onChange={(e) => patch({ maxDailyAffectionGain: Number(e.target.value) || 0 })}
                    />
                </Field>

                <Field label="单日好感最大跌幅" hint="每日因挑衅或攻击性言论最多扣减的好感点数。">
                    <NumberInput
                        min="0"
                        max="100"
                        value={config.maxDailyAffectionLoss}
                        onChange={(e) => patch({ maxDailyAffectionLoss: Number(e.target.value) || 0 })}
                    />
                </Field>
            </div>
        </Panel>

        <Panel title="AI 辅助态度评价" description="可选特性。由轻量模型分析对话态度并由规则引擎受控结算。">
            <Toggle
                checked={config.enableAiEvaluation}
                onChange={(enableAiEvaluation) => patch({ enableAiEvaluation })}
                label="允许 AI 辅助评价对话态度"
                hint="开启后后台将调用模型判定友好/中立/敌意，好感度据此小幅波动，受日上限控制。"
            />
        </Panel>

        <Panel title="熟识度经验等级曲线" description="经验单调递增，达到设定阈值时自动晋级（Lv1 默认 0 起步）。">
            <div className="thresholds-table">
                {currentThresholds.map((th, idx) => (
                    <div key={idx} className="threshold-row flex items-center justify-between p-2 border-b border-line-subtle text-xs">
                        <span className="font-semibold">晋升至 Lv{idx + 2} 所需经验:</span>
                        <div className="flex items-center gap-2">
                            <NumberInput
                                style={{ width: '120px' }}
                                min="1"
                                value={th}
                                onChange={(e) => updateThreshold(idx, Number(e.target.value) || 1)}
                            />
                            <span className="text-muted">Exp</span>
                        </div>
                    </div>
                ))}
            </div>
        </Panel>

        <div className="sticky-save">
            <Button variant="primary" disabled={saving} onClick={() => void onSave()}>
                {saving ? '正在保存' : '保存社交规则'}
            </Button>
        </div>
    </div>
}

// ==================== 辅助小组件 ====================

function UserAvatar({ qq, name, size = 48 }: { qq: string; name: string; size?: number }) {
    const [failed, setFailed] = useState(false)
    const numeric = /^\d{5,12}$/.test(qq)
    return <span className="user-avatar" style={{ width: size, height: size }}>
        {numeric && !failed ? (
            <img
                src={`https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
            />
        ) : (
            <span className="user-avatar-fallback" style={{ fontSize: Math.round(size * 0.36) }} aria-hidden="true">
                {(name.trim() || qq).charAt(0).toLocaleUpperCase()}
            </span>
        )}
    </span>
}
