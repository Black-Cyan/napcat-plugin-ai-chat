import { useEffect, useState } from 'react'
import { useResource } from '../hooks/useResource'
import { apiData, postJson } from '../utils/api'
import type { Sticker } from '../types'
import { Badge, Button, ErrorNotice, Input, Loading, Panel, Textarea } from '../components/ui'

export default function StickersPage() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<Sticker[]>(`/stickers?search=${encodeURIComponent(search)}`)
    return <div className="page-stack">
        <ErrorNotice message={error} />
        <Panel title="表情包库" description="模型依据内容摘要、语境与近期使用情况自主收藏和发送。"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索摘要或标签" /></Panel>
        {loading && !data ? <Loading /> : <div className="sticker-grid">{data?.map((sticker) => <StickerCard key={sticker.id} sticker={sticker} onChange={refresh} />)}</div>}
    </div>
}

function StickerCard({ sticker, onChange }: { sticker: Sticker; onChange: () => Promise<void> }) {
    const [summary, setSummary] = useState(sticker.summary)
    const [image, setImage] = useState('')
    useEffect(() => {
        let active = true
        void apiData<{ mime: string; data: string }>(`/stickers/${sticker.id}/media`).then((media) => {
            if (active) setImage(`data:${media.mime};base64,${media.data}`)
        }).catch(() => undefined)
        return () => { active = false }
    }, [sticker.id])
    const save = async () => { await postJson(`/stickers/${sticker.id}`, { summary }); await onChange() }
    const toggle = async () => { await postJson(`/stickers/${sticker.id}`, { enabled: !sticker.enabled }); await onChange() }
    const remove = async () => {
        if (!confirm('删除这个表情包的本地文件与记录？')) return
        await postJson(`/stickers/${sticker.id}/delete`, {}); await onChange()
    }
    return <article className="sticker-card">
        <div className="sticker-preview">{image ? <img src={image} alt={sticker.summary} /> : <span>图片加载中</span>}</div>
        <div className="sticker-content"><div className="memory-meta"><Badge tone={sticker.enabled ? 'good' : 'warn'}>{sticker.enabled ? '可发送' : '已停用'}</Badge><span>见过 {sticker.seenCount} 次</span><span>用过 {sticker.useCount} 次</span></div>
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <div className="tag-list">{sticker.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="button-row"><Button onClick={() => void save()}>保存摘要</Button><Button onClick={() => void toggle()}>{sticker.enabled ? '停用' : '启用'}</Button><Button variant="danger" onClick={() => void remove()}>删除</Button></div>
        </div>
    </article>
}
