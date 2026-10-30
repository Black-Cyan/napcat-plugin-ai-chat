import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import ToastContainer from './components/ToastContainer'
import StatusPage from './pages/StatusPage'
import BehaviorPage from './pages/BehaviorPage'
import ProvidersPage from './pages/ProvidersPage'
import PromptsPage from './pages/PromptsPage'
import ConversationsPage from './pages/ConversationsPage'
import MemoriesPage from './pages/MemoriesPage'
import StickersPage from './pages/StickersPage'
import AccessControlPage from './pages/AccessControlPage'
import DatabasePage from './pages/DatabasePage'
import DataPage from './pages/DataPage'
import LogsPage from './pages/LogsPage'
import { useStatus } from './hooks/useStatus'
import { useTheme } from './hooks/useTheme'

export type PageId = 'status' | 'behavior' | 'providers' | 'prompts' | 'conversations' | 'memories' | 'stickers' | 'blacklist' | 'database' | 'data' | 'logs'

const pages: Record<PageId, { title: string; desc: string }> = {
    status: { title: '对话现场', desc: '查看机器人此刻的参与状态与处理队列' },
    behavior: { title: '行为与上下文', desc: '调整参与方式、消息批次和记忆预算' },
    providers: { title: '模型', desc: '管理 OpenAI、Anthropic 与 Google 模型配置' },
    prompts: { title: '提示词方案', desc: '定义可复用的人格与表达习惯' },
    conversations: { title: '会话', desc: '管理隔离历史、独立配置与原始消息' },
    memories: { title: '用户记忆', desc: '查看记忆的来源范围与传播边界' },
    stickers: { title: '表情包', desc: '管理模型理解、收藏和复用的表情' },
    blacklist: { title: '访问控制', desc: '全局黑名单与白名单管理，控制机器人消息接收范围' },
    database: { title: '数据库', desc: '配置 SQLite、PostgreSQL 或 MySQL' },
    data: { title: '备份与迁移', desc: '导出或合并业务数据，不包含任何密钥' },
    logs: { title: '运行日志', desc: '查看当前进程的脱敏诊断信息' },
}

export default function App() {
    const [currentPage, setCurrentPage] = useState<PageId>('status')
    const [isScrolled, setIsScrolled] = useState(false)
    const { status, fetchStatus } = useStatus()
    useTheme()
    useEffect(() => {
        void fetchStatus()
        const interval = setInterval(() => void fetchStatus(), 5000)
        return () => clearInterval(interval)
    }, [fetchStatus])
    const renderPage = () => {
        switch (currentPage) {
            case 'status': return <StatusPage status={status} onRefresh={() => void fetchStatus()} />
            case 'behavior': return <BehaviorPage />
            case 'providers': return <ProvidersPage />
            case 'prompts': return <PromptsPage />
            case 'conversations': return <ConversationsPage />
            case 'memories': return <MemoriesPage />
            case 'stickers': return <StickersPage />
            case 'blacklist': return <AccessControlPage />
            case 'database': return <DatabasePage />
            case 'data': return <DataPage />
            case 'logs': return <LogsPage />
        }
    }
    return <div className="app-shell">
        <ToastContainer />
        <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
        <div className="main-shell">
            <Header title={pages[currentPage].title} description={pages[currentPage].desc} isScrolled={isScrolled} status={status} currentPage={currentPage} />
            <main className="main-content" onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 8)}>
                <div key={currentPage} className="page-enter">{renderPage()}</div>
            </main>
        </div>
    </div>
}
