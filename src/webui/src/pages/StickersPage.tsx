import { useEffect, useState } from 'react'
import { useResource } from '../hooks/useResource'
import { apiData, postJson } from '../utils/api'
import type { Sticker } from '../types'
import { Badge, Button, ErrorNotice, Input, Loading, Panel, Textarea } from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'

export default function StickersPage() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<Sticker[]>(`/stickers?search=${encodeURIComponent(search)}`)
    const [selected, setSelected] = useState<Sticker | null>(null)
    return <div className="page-stack">
        <ErrorNotice message={error} />
        <Panel title="表情包库" description="点右侧三点管理。">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索摘要或标签" />
        </Panel>
        {loading && !data ? <Loading /> : <div className="sticker-grid">{data?.map((sticker) => (
            <StickerCard key={sticker.id} sticker={sticker} onOpen={() => setSelected(sticker)} onChange={refresh} />
        ))}</div>}
        {selected && <StickerPanel sticker={selected} onClose={() => setSelected(null)} onChange={refresh} />}
    </div>
}

function useStickerImage(id: string) {
    const [image, setImage] = useState('')
    useEffect(() => {
        let active = true
        void apiData<{ mime: string; data: string }>(`/stickers/${id}/media`).then((media) => {
            if (active) setImage(`data:${media.mime};base64,${media.data}`)
        }).catch(() => undefined)
        return () => { active = false }
    }, [id])
    return image
}

function StickerCard({ sticker, onOpen, onChange }: { sticker: Sticker; onOpen: () => void; onChange: () => Promise<void> }) {
    const ask = useConfirm()
    const image = useStickerImage(sticker.id)
    const toggle = async () => { await postJson(`/stickers/${sticker.id}`, { enabled: !sticker.enabled }); await onChange() }
    const remove = async () => {
        if (!await ask({ title: '删除这个表情包？', description: '将同时删除本地图片文件与收藏记录。' })) return
        await postJson(`/stickers/${sticker.id}/delete`, {}); await onChange()
    }
    return <article className="sticker-card">
        <div className="sticker-preview">{image ? <img src={image} alt={sticker.summary} /> : <span>图片加载中</span>}</div>
        <div className="sticker-content">
            <div className="memory-meta">
                <Badge tone={sticker.enabled ? 'good' : 'warn'}>{sticker.enabled ? '可发送' : '已停用'}</Badge>
                <span>见过 {sticker.seenCount} 次</span><span>用过 {sticker.useCount} 次</span>
                <PopoverMenu actions={[
                    { label: '配置', onSelect: onOpen },
                    { label: sticker.enabled ? '停用' : '启用', onSelect: () => void toggle() },
                    { label: '删除', danger: true, onSelect: () => void remove() },
                ]} />
            </div>
            <p className="memory-content">{sticker.summary}</p>
            <div className="tag-list">{sticker.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </div>
    </article>
}

function StickerPanel({ sticker, onClose, onChange }: { sticker: Sticker; onClose: () => void; onChange: () => Promise<void> }) {
    const ask = useConfirm()
    const image = useStickerImage(sticker.id)
    const [summary, setSummary] = useState(sticker.summary)
    const [notice, setNotice] = useState('')
    const save = async () => {
        try { await postJson(`/stickers/${sticker.id}`, { summary }); setNotice('摘要已保存'); await onChange() }
        catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存失败') }
    }
    const toggle = async () => { await postJson(`/stickers/${sticker.id}`, { enabled: !sticker.enabled }); await onChange(); onClose() }
    const remove = async () => {
        if (!await ask({ title: '删除这个表情包？', description: '将同时删除本地图片文件与收藏记录。' })) return
        await postJson(`/stickers/${sticker.id}/delete`, {}); await onChange(); onClose()
    }
    return <SidePanel
        title="表情包详情"
        subtitle={`见过 ${sticker.seenCount} 次 · 用过 ${sticker.useCount} 次`}
        onClose={onClose}
        footer={<>
            <Button variant="danger" onClick={() => void remove()}>删除</Button>
            <div className="flex items-center gap-2">
                <Button onClick={() => void toggle()}>{sticker.enabled ? '停用' : '启用'}</Button>
                <Button variant="primary" onClick={() => void save()}>保存摘要</Button>
            </div>
        </>}
    >
        <div className="sticker-preview sticker-preview-large">{image ? <img src={image} alt={sticker.summary} /> : <span>图片加载中</span>}</div>
        <Textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div className="tag-list">{sticker.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        {notice && <small>{notice}</small>}
    </SidePanel>
}
