import { useRef, useState } from 'react'
import { IconDownload } from '../components/icons'
import { apiData, postJson } from '../utils/api'
import { Notice, Button, ErrorNotice, Panel } from '../components/ui'
import { useConfirm } from '../components/Overlay'

export default function DataPage() {
    const ask = useConfirm()
    const fileInput = useRef<HTMLInputElement>(null)
    const [notice, setNotice] = useState('')
    const [error, setError] = useState('')
    const [dragActive, setDragActive] = useState(false)
    const [fileName, setFileName] = useState('')
    const exportData = async () => {
        setError(''); setNotice('')
        try {
            const data = await apiData<Record<string, unknown>>('/export')
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url; anchor.download = `napcat-ai-chat-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
            URL.revokeObjectURL(url); setNotice('数据已导出，不包含模型密钥和数据库密码')
        } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败') }
    }
    const importData = async (file: File) => {
        setError(''); setNotice(''); setFileName(file.name)
        try {
            if (file.size > 200 * 1024 * 1024) throw new Error('导入文件超过 200 MB')
            if (!await ask({ title: '导入并合并数据？', description: '导入会与现有数据按主键合并，同名记录不会覆盖。' })) return
            const data = JSON.parse(await file.text())
            await postJson('/import', data)
            setNotice('导入完成。黑名单缓存已刷新。')
        } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败') }
        finally { if (fileInput.current) fileInput.current.value = '' }
    }
    return <div className="page-stack narrow-page">
        <ErrorNotice message={error} /><Notice message={notice} />
        <Panel title="导出业务数据" description="包含会话、原始消息、摘要、提示词、记忆、黑名单和表情包元数据。">
            <p className="muted">导出包含聊天内容，不含模型密钥与数据库密码。</p>
            <Button variant="primary" onClick={() => void exportData()}>导出 JSON 数据</Button>
        </Panel>
        <Panel title="导入数据" description="用于迁移到另一个已初始化的数据库。">
            
            <div
                className={`dropzone ${dragActive ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click() }}
                onDragOver={(event) => { event.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                    event.preventDefault(); setDragActive(false)
                    const file = event.dataTransfer.files?.[0]
                    if (file) void importData(file)
                }}
            >
                <IconDownload size={22} />
                <strong>拖拽 JSON 文件到这里，或点击选择</strong>
                <span>按主键合并，不覆盖现有记录，最大 200 MB</span>
                {fileName && <span className="dropzone-file">{fileName}</span>}
            </div>
            <input ref={fileInput} className="dropzone-input" type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
        </Panel>
    </div>
}
