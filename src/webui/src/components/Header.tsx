import type { PageId } from '../App'
import type { PluginStatus } from '../types'
import { useTheme } from '../hooks/useTheme'
import { IconMoon, IconSun } from './icons'

export default function Header({
    title,
    description,
    isScrolled,
    status,
}: {
    title: string
    description: string
    isScrolled: boolean
    status: PluginStatus | null
    currentPage: PageId
}) {
    const { theme, toggleTheme } = useTheme()

    return (
        <header className={`top-header ${isScrolled ? 'scrolled' : ''}`}>
            <div>
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
            <div className="flex items-center gap-3">
                <div className="header-status">
                    <span className={`status-dot ${status?.ready ? 'online' : 'offline'}`} />
                    <span>{status ? (status.ready ? '已连接运行中' : '等待就绪') : '连接中...'}</span>
                    {status?.database && <span className="header-db-badge">{status.database}</span>}
                </div>

                <button
                    type="button"
                    className="theme-button"
                    onClick={toggleTheme}
                    title={`当前主题：${theme === 'auto' ? '跟随系统' : theme === 'dark' ? '深色模式' : '浅色模式'}（点击切换）`}
                >
                    {theme === 'dark' ? <IconMoon size={16} /> : <IconSun size={16} />}
                </button>
            </div>
        </header>
    )
}
