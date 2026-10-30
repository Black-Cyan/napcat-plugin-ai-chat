import { useState } from 'react'
import { useResource } from '../hooks/useResource'
import { postJson } from '../utils/api'
import type { UserMemory } from '../types'
import { Badge, Button, ErrorNotice, Input, Loading, Panel, Select, Textarea } from '../components/ui'

export default function MemoriesPage() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<UserMemory[]>(`/memories?search=${encodeURIComponent(search)}`)
    return <div className="page-stack">
        <ErrorNotice message={error} />
        <Panel title="用户记忆" description="私聊记忆只能用于私聊；群聊记忆可跨群及用于私聊。">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 QQ 号或记忆内容" />
        </Panel>
        {loading && !data ? (
            <Loading />
        ) : data && data.length > 0 ? (
            <div className="memory-list">{data.map((memory) => <MemoryRow key={memory.id} memory={memory} onChange={refresh} />)}</div>
        ) : (
            <div className="empty" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <strong style={{ display: 'block', marginBottom: '0.5rem' }}>暂无用户记忆</strong>
                <span className="text-xs text-muted" style={{ color: 'var(--color-muted)' }}>
                    {search ? '没有匹配搜索条件的用户记忆。' : '当用户在聊天中提及个人事实或偏好（如兴趣爱好、常住地、职业习惯等）时，AI 会在后台自动提炼并记录在此处。'}
                </span>
            </div>
        )}
    </div>
}

function MemoryRow({ memory, onChange }: { memory: UserMemory; onChange: () => Promise<void> }) {
    const [content, setContent] = useState(memory.content)
    const [scope, setScope] = useState(memory.scope)
    const [notice, setNotice] = useState('')
    const save = async () => {
        if (scope === 'group' && memory.scope === 'private' && !confirm('这会把原本仅限私聊的记忆开放到群聊，确定继续？')) return
        try { await postJson(`/memories/${memory.id}`, { content, scope }); setNotice('已保存'); await onChange() }
        catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存失败') }
    }
    const toggle = async () => { await postJson(`/memories/${memory.id}`, { valid: !memory.valid }); await onChange() }
    const remove = async () => {
        if (!confirm('永久删除这条记忆？')) return
        await postJson(`/memories/${memory.id}/delete`, {}); await onChange()
    }
    return <article className="memory-item">
        <div className="memory-meta"><Badge tone={memory.scope === 'private' ? 'warn' : 'neutral'}>{memory.scope === 'private' ? '仅限私聊' : '群聊来源'}</Badge><span>QQ {memory.qq}</span><span>置信度 {memory.confidence}%</span><span>使用 {memory.useCount} 次</span></div>
        <Textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="memory-actions"><Select value={scope} onChange={(e) => setScope(e.target.value as 'private' | 'group')}><option value="private">仅限私聊</option><option value="group">群聊来源</option></Select><Button onClick={() => void save()}>保存</Button><Button onClick={() => void toggle()}>{memory.valid ? '停用' : '启用'}</Button><Button variant="danger" onClick={() => void remove()}>删除</Button></div>
        {notice && <small>{notice}</small>}
    </article>
}
