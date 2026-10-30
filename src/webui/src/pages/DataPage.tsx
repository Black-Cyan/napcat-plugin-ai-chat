import { useRef, useState } from 'react'
import { apiData, postJson } from '../utils/api'
import { Button, ErrorNotice, Panel } from '../components/ui'

export default function DataPage() {
    const fileInput = useRef<HTMLInputElement>(null)
    const [notice, setNotice] = useState('')
    const [error, setError] = useState('')
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
        setError(''); setNotice('')
        try {
            if (file.size > 200 * 1024 * 1024) throw new Error('导入文件超过 200 MB')
            if (!confirm('导入会与现有数据按主键合并，同名记录不会覆盖。确定继续？')) return
            const data = JSON.parse(await file.text())
            await postJson('/import', data)
            setNotice('导入完成。黑名单缓存已刷新。')
        } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败') }
        finally { if (fileInput.current) fileInput.current.value = '' }
    }
    return <div className="page-stack narrow-page">
        <ErrorNotice message={error} />{notice && <div className="notice">{notice}</div>}
        <Panel title="导出业务数据" description="包含会话、原始消息、摘要、提示词、记忆、黑名单和表情包元数据。">
            <p className="muted">导出文件包含敏感聊天内容，请妥善保管。模型密钥、数据库密码和普通媒体缓存不会包含在文件中。</p>
            <Button variant="primary" onClick={() => void exportData()}>导出 JSON 数据</Button>
        </Panel>
        <Panel title="导入数据" description="用于迁移到另一个已初始化的数据库。">
            <p className="muted">导入按主键合并，不覆盖现有记录。表情包文件需要在目标环境重新收藏；仅导入元数据不会复制本地图片。</p>
            <input ref={fileInput} type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && void importData(e.target.files[0])} />
        </Panel>
    </div>
}
