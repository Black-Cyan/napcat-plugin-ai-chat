import type { PageId } from '../App'
import {
    IconActivity,
    IconBrain,
    IconDashboard,
    IconDatabase,
    IconDownload,
    IconMessage,
    IconPlugin,
    IconSettings,
    IconShield,
    IconSmile,
    IconTerminal,
} from './icons'

const groups: Array<{ label: string; items: Array<{ id: PageId; label: string; icon: React.ReactNode }> }> = [
    { label: '对话', items: [
        { id: 'status', label: '对话现场', icon: <IconDashboard size={17} /> },
        { id: 'conversations', label: '会话管理', icon: <IconMessage size={17} /> },
        { id: 'memories', label: '用户记忆', icon: <IconActivity size={17} /> },
        { id: 'stickers', label: '表情包库', icon: <IconSmile size={17} /> },
    ] },
    { label: '智能', items: [
        { id: 'behavior', label: '行为与上下文', icon: <IconSettings size={17} /> },
        { id: 'providers', label: '模型配置', icon: <IconPlugin size={17} /> },
        { id: 'prompts', label: '提示词方案', icon: <IconBrain size={17} /> },
    ] },
    { label: '系统', items: [
        { id: 'blacklist', label: '访问控制', icon: <IconShield size={17} /> },
        { id: 'database', label: '数据库', icon: <IconDatabase size={17} /> },
        { id: 'data', label: '备份与迁移', icon: <IconDownload size={17} /> },
        { id: 'logs', label: '运行日志', icon: <IconTerminal size={17} /> },
    ] },
]

export default function Sidebar({ currentPage, onPageChange }: { currentPage: PageId; onPageChange: (page: PageId) => void }) {
    return <aside className="sidebar">
        <div className="brand">
            <div className="brand-mark">
                <span />
                <span />
                <span />
            </div>
            <div>
                <strong>AI Chat</strong>
                <small>NapCat Plugin</small>
            </div>
        </div>
        <nav className="sidebar-nav">
            {groups.map((group) => (
                <div className="nav-group" key={group.label}>
                    <span className="nav-label">{group.label}</span>
                    {group.items.map((item) => (
                        <button
                            key={item.id}
                            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                            onClick={() => onPageChange(item.id)}
                        >
                            {item.icon}
                            <span>{item.label}</span>
                        </button>
                    ))}
                </div>
            ))}
        </nav>
        <div className="sidebar-footer">
            <a className="repo-link" href="https://github.com/Black-Cyan/napcat-plugin-ai-chat" target="_blank" rel="noreferrer">
                文档与源码 ↗
            </a>
        </div>
    </aside>
}
