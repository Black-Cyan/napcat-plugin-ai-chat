import { useMemo, useState } from 'react'
import { useResource } from '../hooks/useResource'
import { postJson } from '../utils/api'
import type { MemoryUserSummary, UserMemory } from '../types'
import { Badge, Button, Empty, ErrorNotice, Input, Loading, Panel, Select, Textarea } from '../components/ui'
import { IconArrowLeft, IconChevronRight } from '../components/icons'

type ScopeFilter = 'all' | 'group' | 'private' | 'inactive'

const scopeFilters: Array<{ key: ScopeFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'group', label: '群聊来源' },
    { key: 'private', label: '仅限私聊' },
    { key: 'inactive', label: '已停用' },
]

function formatTime(value: number): string {
    if (!value) return '未知'
    return new Date(value).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    })
}

export default function MemoriesPage() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<MemoryUserSummary[]>(`/memories/users?search=${encodeURIComponent(search)}`)
    const [selected, setSelected] = useState<MemoryUserSummary | null>(null)
    const totals = useMemo(() => (data ?? []).reduce((sum, user) => sum + user.total, 0), [data])

    return <div className="page-stack">
        <ErrorNotice message={error} />
        {selected ? (
            <UserMemories key={selected.qq} user={selected} onBack={async () => { setSelected(null); await refresh() }} />
        ) : (
            <>
                <Panel title="用户记忆" description="私聊记忆只能用于私聊；群聊记忆可跨群及用于私聊。按用户查看并审核 AI 提炼的事实与偏好。">
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索昵称、称呼、QQ 号或记忆内容" />
                    {data && data.length > 0 && <p className="memory-summary">{data.length} 位用户 · 共 {totals} 条记忆</p>}
                </Panel>
                {loading && !data ? (
                    <Loading />
                ) : data && data.length > 0 ? (
                    <div className="memory-users-grid">{data.map((user) => <UserCard key={user.qq} user={user} onOpen={() => setSelected(user)} />)}</div>
                ) : (
                    <Empty
                        title={search ? '没有匹配的用户' : '暂无用户记忆'}
                        description={search
                            ? '换一个昵称、称呼、QQ 号或记忆关键词试试。'
                            : '当用户在聊天中提及个人事实或偏好（如兴趣爱好、常住地、职业习惯等）时，AI 会在后台自动提炼并按用户归类到这里。'}
                    />
                )}
            </>
        )}
    </div>
}

function UserCard({ user, onOpen }: { user: MemoryUserSummary; onOpen: () => void }) {
    return <button type="button" className="memory-user-card" onClick={onOpen} aria-label={`查看 ${user.displayName || `QQ ${user.qq}`} 的记忆`}>
        <UserAvatar qq={user.qq} name={user.displayName} size={48} />
        <span className="memory-user-identity">
            <strong>{user.displayName || '未记录昵称'}</strong>
            <span className="memory-user-qq">QQ {user.qq}</span>
            {user.address && <span className="memory-user-address">称呼 {user.address}</span>}
        </span>
        <span className="memory-user-stats">
            <span className="memory-user-count">{user.total} 条记忆</span>
            <span className="memory-user-tags">
                {user.groupCount > 0 && <Badge>群聊 {user.groupCount}</Badge>}
                {user.privateCount > 0 && <Badge tone="warn">私聊 {user.privateCount}</Badge>}
            </span>
        </span>
        <IconChevronRight size={18} className="memory-user-chevron" />
    </button>
}

function UserMemories({ user, onBack }: { user: MemoryUserSummary; onBack: () => Promise<void> }) {
    const [profile, setProfile] = useState(user)
    const [address, setAddress] = useState(user.address)
    const [savingAddress, setSavingAddress] = useState(false)
    const { data, loading, error, refresh } = useResource<UserMemory[]>(`/memories?qq=${encodeURIComponent(user.qq)}`)
    const [filter, setFilter] = useState<ScopeFilter>('all')
    const [keyword, setKeyword] = useState('')
    const [notice, setNotice] = useState('')
    const visible = useMemo(() => {
        const text = keyword.trim().toLocaleLowerCase()
        return (data ?? []).filter((memory) => {
            if (filter === 'inactive') return !memory.valid
            if (!memory.valid) return filter === 'all'
            return filter === 'all' || memory.scope === filter
        }).filter((memory) => !text || memory.content.toLocaleLowerCase().includes(text))
    }, [data, filter, keyword])
    const counts = useMemo(() => ({
        all: data?.length ?? 0,
        group: data?.filter((memory) => memory.scope === 'group').length ?? 0,
        private: data?.filter((memory) => memory.scope === 'private').length ?? 0,
        inactive: data?.filter((memory) => !memory.valid).length ?? 0,
    }), [data])

    const saveAddress = async () => {
        setSavingAddress(true)
        setNotice('')
        try {
            await postJson(`/memories/users/${user.qq}`, { address: address.trim() })
            setProfile({ ...profile, address: address.trim(), addressManual: Boolean(address.trim()) })
            setNotice(address.trim() ? '称呼已保存，后续对话会按此称呼对方' : '已清空称呼，AI 会在后续聊天中按昵称重新生成')
        } catch (reason) { setNotice(reason instanceof Error ? reason.message : '称呼保存失败') }
        finally { setSavingAddress(false) }
    }

    return <>
        <ErrorNotice message={error} />
        {notice && <div className="notice">{notice}</div>}
        <Button variant="quiet" className="memory-back" onClick={() => void onBack()}>
            <IconArrowLeft size={16} />返回用户列表
        </Button>
        <Panel>
            <div className="memory-profile">
                <UserAvatar qq={user.qq} name={user.displayName} size={56} />
                <div className="memory-profile-identity">
                    <strong>{user.displayName || '未记录昵称'}</strong>
                    <span className="memory-user-qq">QQ {user.qq}</span>
                    <span className="memory-user-address">当前称呼 {profile.address || '未设置'}</span>
                </div>
                <div className="memory-profile-stats">
                    <span>{counts.all} 条记忆</span>
                    <span>{counts.private} 条仅限私聊</span>
                    <span>最近更新 {formatTime(user.lastUpdatedAt)}</span>
                </div>
            </div>
            <div className="memory-address-editor">
                <Input
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="例如：奶绿姐、Cap 同学、字母哥"
                    maxLength={30}
                    aria-label="对该用户的称呼"
                />
                <Button variant="primary" disabled={savingAddress || address.trim() === profile.address} onClick={() => void saveAddress()}>保存称呼</Button>
                <span className="memory-address-hint">AI 按昵称生成自然简称与后缀；留空保存可重新生成。</span>
            </div>
            <div className="memory-toolbar">
                <div className="memory-filters" role="group" aria-label="按来源筛选记忆">
                    {scopeFilters.map((item) => <button
                        key={item.key}
                        type="button"
                        className={`memory-filter ${filter === item.key ? 'active' : ''}`}
                        aria-pressed={filter === item.key}
                        onClick={() => setFilter(item.key)}
                    >{item.label}<span>{counts[item.key]}</span></button>)}
                </div>
                <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索该用户的记忆内容" className="memory-search" />
            </div>
            {loading && !data ? (
                <Loading />
            ) : visible.length > 0 ? (
                <div className="memory-list">{visible.map((memory) => <MemoryRow key={memory.id} memory={memory} onChange={refresh} onNotice={setNotice} />)}</div>
            ) : (
                <Empty
                    title={counts.all === 0 ? '该用户暂无记忆' : '当前筛选下没有记忆'}
                    description={counts.all === 0
                        ? '后续聊天中出现的稳定事实与偏好会自动补充到这里。'
                        : '切换上方的来源筛选，或清空搜索关键词。'}
                />
            )}
        </Panel>
    </>
}

function MemoryRow({ memory, onChange, onNotice }: { memory: UserMemory; onChange: () => Promise<void>; onNotice: (text: string) => void }) {
    const [editing, setEditing] = useState(false)
    const [content, setContent] = useState(memory.content)
    const [scope, setScope] = useState(memory.scope)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const run = async (action: () => Promise<void>) => {
        setBusy(true)
        setError('')
        try { await action(); await onChange() }
        catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败') }
        finally { setBusy(false) }
    }
    const save = () => run(async () => {
        if (!content.trim()) throw new Error('记忆内容不能为空')
        if (scope === 'group' && memory.scope === 'private' && !confirm('这会把原本仅限私聊的记忆开放到群聊，确定继续？')) return
        await postJson(`/memories/${memory.id}`, { content: content.trim(), scope })
        setEditing(false)
        onNotice('记忆已保存')
    })
    const toggle = () => run(async () => {
        await postJson(`/memories/${memory.id}`, { valid: !memory.valid })
        onNotice(memory.valid ? '已停用该记忆，模型不会再引用' : '已重新启用该记忆')
    })
    const remove = () => {
        if (!confirm(`永久删除这条记忆？\n\n${memory.content}`)) return
        void run(async () => { await postJson(`/memories/${memory.id}/delete`, {}); onNotice('记忆已删除') })
    }

    return <article className={`memory-item ${memory.valid ? '' : 'inactive'}`}>
        <div className="memory-meta">
            <Badge tone={memory.scope === 'private' ? 'warn' : 'neutral'}>{memory.scope === 'private' ? '仅限私聊' : '群聊来源'}</Badge>
            {!memory.valid && <Badge tone="danger">{memory.supersededBy ? '已被新记忆替代' : '已停用'}</Badge>}
            <span>重要度 {memory.importance}/5</span>
            <span>置信度 {memory.confidence}%</span>
            <span>引用 {memory.useCount} 次</span>
            <span className="memory-time">更新于 {formatTime(memory.updatedAt)}</span>
        </div>
        {editing ? (
            <div className="memory-edit">
                <Textarea rows={3} value={content} onChange={(event) => setContent(event.target.value)} autoFocus />
                <div className="memory-actions">
                    <Select value={scope} onChange={(event) => setScope(event.target.value as 'private' | 'group')} aria-label="记忆可见范围">
                        <option value="private">仅限私聊</option>
                        <option value="group">群聊来源</option>
                    </Select>
                    <Button variant="primary" disabled={busy} onClick={() => void save()}>保存</Button>
                    <Button variant="quiet" disabled={busy} onClick={() => { setEditing(false); setContent(memory.content); setScope(memory.scope); setError('') }}>取消</Button>
                </div>
            </div>
        ) : (
            <>
                <p className="memory-content">{memory.content}</p>
                <div className="memory-actions">
                    <Button variant="quiet" disabled={busy} onClick={() => setEditing(true)}>编辑</Button>
                    <Button variant="quiet" disabled={busy} onClick={() => void toggle()}>{memory.valid ? '停用' : '启用'}</Button>
                    <Button variant="quiet" className="memory-delete" disabled={busy} onClick={remove}>删除</Button>
                </div>
            </>
        )}
        {error && <small className="memory-error" role="alert">{error}</small>}
    </article>
}

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
