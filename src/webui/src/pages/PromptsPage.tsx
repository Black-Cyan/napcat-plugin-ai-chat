import { useState } from 'react'
import { useResource } from '../hooks/useResource'
import { postJson } from '../utils/api'
import type { PromptProfile } from '../types'
import { Notice, Badge, Button, ErrorNotice, Field, Input, Loading, Panel, Textarea } from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'

export default function PromptsPage() {
    const { data, loading, error, refresh } = useResource<PromptProfile[]>('/prompts')
    const ask = useConfirm()
    const [selected, setSelected] = useState<PromptProfile | null>(null)
    const [panelOpen, setPanelOpen] = useState(false)
    const [name, setName] = useState('')
    const [content, setContent] = useState('')
    const [isDefault, setIsDefault] = useState(false)
    const [notice, setNotice] = useState('')
    const choose = (profile: PromptProfile) => {
        setSelected(profile); setName(profile.name); setContent(profile.content); setIsDefault(profile.isDefault); setPanelOpen(true)
    }
    const add = () => { setSelected(null); setName('新提示词方案'); setContent(''); setIsDefault(false); setPanelOpen(true) }
    const save = async () => {
        try {
            const saved = await postJson<PromptProfile>('/prompts', { id: selected?.id, name, content, isDefault })
            setNotice('提示词方案已保存'); setSelected(saved); await refresh()
        } catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存失败') }
    }
    const remove = async (profile: PromptProfile) => {
        if (profile.isDefault) return
        if (!await ask({ title: `删除提示词方案“${profile.name}”？`, description: '使用它的会话会回退到全局默认方案。' })) return
        try {
            await postJson(`/prompts/${profile.id}/delete`, {})
            setPanelOpen(false); setSelected(null); await refresh()
        } catch (reason) { setNotice(reason instanceof Error ? reason.message : '删除失败') }
    }
    if (loading && !data) return <Loading label="正在读取提示词方案" />
    return <div className="page-stack">
        <ErrorNotice message={error} /><Notice message={notice} />
        <Panel title="提示词方案" description="一套方案可分配给多个会话。" actions={<Button variant="primary" onClick={add}>新建方案</Button>}>
            <div className="resource-list">{data?.map((profile) => <div key={profile.id} className={`resource-row object-row ${selected?.id === profile.id && panelOpen ? 'selected' : ''}`}>
                <button type="button" className="object-main resource-row-button" onClick={() => choose(profile)}>
                    <strong>{profile.name}</strong><small>{profile.content.slice(0, 42) || '空白提示词'}</small>
                </button>
                {profile.isDefault && <Badge tone="good">全局默认</Badge>}
                <PopoverMenu actions={[
                    { label: '配置', onSelect: () => choose(profile) },
                    { label: '删除', danger: true, disabled: profile.isDefault, onSelect: () => void remove(profile) },
                ]} />
            </div>)}</div>
        </Panel>

        {panelOpen && <SidePanel
            title={selected ? selected.name : '创建提示词方案'}
            subtitle="人格与语气可自定义，隐私、黑名单和工具权限不能被提示词覆盖"
            onClose={() => setPanelOpen(false)}
            footer={<>
                {selected && !selected.isDefault ? <Button variant="danger" onClick={() => void remove(selected)}>删除</Button> : <span />}
                <Button variant="primary" onClick={() => void save()}>保存方案</Button>
            </>}
        >
            <Field label="方案名称" wide><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="提示词正文" hint="建议描述语气、回复长度、兴趣和边界，不要在这里写入密钥。" wide>
                <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} placeholder="例如：像熟悉的群友一样自然说话，回复简短，不刻意找话……" />
            </Field>
            <label className="check-row"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />设为全局默认方案</label>
        </SidePanel>}
    </div>
}
