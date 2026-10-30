import { useState } from 'react'
import { useResource } from '../hooks/useResource'
import { postJson } from '../utils/api'
import type { PromptProfile } from '../types'
import { Badge, Button, ErrorNotice, Field, Input, Loading, Panel, Textarea } from '../components/ui'

export default function PromptsPage() {
    const { data, setData, loading, error, refresh } = useResource<PromptProfile[]>('/prompts')
    const [selected, setSelected] = useState<PromptProfile | null>(null)
    const [name, setName] = useState('')
    const [content, setContent] = useState('')
    const [isDefault, setIsDefault] = useState(false)
    const [notice, setNotice] = useState('')
    const choose = (profile: PromptProfile) => { setSelected(profile); setName(profile.name); setContent(profile.content); setIsDefault(profile.isDefault) }
    const add = () => { setSelected(null); setName('新提示词方案'); setContent(''); setIsDefault(false) }
    const save = async () => {
        try {
            const saved = await postJson<PromptProfile>('/prompts', { id: selected?.id, name, content, isDefault })
            setNotice('提示词方案已保存'); setSelected(saved); await refresh()
        } catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存失败') }
    }
    const remove = async () => {
        if (!selected || selected.isDefault || !confirm(`删除“${selected.name}”？`)) return
        try { await postJson(`/prompts/${selected.id}/delete`, {}); setSelected(null); setData(null); await refresh() }
        catch (reason) { setNotice(reason instanceof Error ? reason.message : '删除失败') }
    }
    if (loading && !data) return <Loading label="正在读取提示词方案" />
    return <div className="page-stack">
        <ErrorNotice message={error} />{notice && <div className="notice">{notice}</div>}
        <div className="editor-layout">
            <Panel title="提示词方案" description="一套方案可以分配给多个会话。" actions={<Button variant="primary" onClick={add}>新建方案</Button>}>
                <div className="resource-list">{data?.map((profile) => <button key={profile.id} className={`resource-row ${selected?.id === profile.id ? 'selected' : ''}`} onClick={() => choose(profile)}>
                    <span><strong>{profile.name}</strong><small>{profile.content.slice(0, 42) || '空白提示词'}</small></span>{profile.isDefault && <Badge tone="good">全局默认</Badge>}
                </button>)}</div>
            </Panel>
            <Panel title={selected ? '编辑方案' : '创建方案'} description="人格与语气可以自定义，但隐私、黑名单和工具权限不能被提示词覆盖。">
                <Field label="方案名称" wide><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="提示词正文" hint="建议描述语气、回复长度、兴趣和边界，不要在这里写入密钥。" wide>
                    <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：像熟悉的群友一样自然说话，回复简短，不刻意找话……" />
                </Field>
                <label className="check-row"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />设为全局默认方案</label>
                <div className="button-row"><Button variant="primary" onClick={() => void save()}>保存方案</Button>{selected && !selected.isDefault && <Button variant="danger" onClick={() => void remove()}>删除方案</Button>}</div>
            </Panel>
        </div>
    </div>
}
