import type { PluginConfig, PluginStatus } from '../types'
import { useResource } from '../hooks/useResource'
import { Badge, Button, ErrorNotice, Loading, Panel } from '../components/ui'
import {
    IconActivity,
    IconClock,
    IconDatabase,
    IconDownload,
    IconGroup,
    IconMessage,
    IconPlugin,
    IconPower,
    IconRefresh,
    IconSmile,
} from '../components/icons'

export default function StatusPage({ status, onRefresh }: { status: PluginStatus | null; onRefresh: () => void }) {
    const { data: config } = useResource<PluginConfig>('/config')
    if (!status) return <Loading label="正在连接插件运行状态..." />

    const engagement = config?.behavior.engagement ?? 0.7
    const engagementPercent = Math.round(engagement * 100)

    return (
        <div className="page-stack">
            <ErrorNotice message={status.initializationError} />

            {/* Hero Card: Modern listening state */}
            <section className={`hero-card ${status.ready ? 'is-active' : 'is-idle'}`}>
                <div className="hero-content">
                    <div className="hero-status-pill">
                        <span className={`status-dot ${status.ready ? 'online' : 'offline'}`} />
                        <span>{status.ready ? '正在倾听对话' : '等待初始化'}</span>
                    </div>
                    <h3>{status.ready ? '正在自然参与聊天，等待值得加入的对话。' : '控制台在线，机器人环境尚未就绪。'}</h3>
                    <p>
                        {status.ready
                            ? '新消息按会话顺序汇入批次；机器人根据意愿和上下文决策回复，也可返回静默。'
                            : '请先在“模型配置”和“数据库”中完善基础连接设置，随后即可开启对话。'}
                    </p>
                </div>

                <div className="hero-engagement-card">
                    <div className="engagement-circle" style={{ '--percent': `${engagementPercent}%` } as React.CSSProperties}>
                        <div className="circle-inner">
                            <strong>{engagementPercent}%</strong>
                            <small>参与意愿</small>
                        </div>
                    </div>
                </div>
            </section>

            {/* Metrics Ledger */}
            <div className="metrics-grid">
                <div className="metric-card">
                    <div className="metric-icon bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                        <IconMessage size={18} />
                    </div>
                    <div className="metric-data">
                        <span>已保存消息</span>
                        <strong>{(status.resources?.messages ?? 0).toLocaleString()}</strong>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <IconGroup size={18} />
                    </div>
                    <div className="metric-data">
                        <span>活跃会话</span>
                        <strong>{(status.resources?.conversations ?? 0).toLocaleString()}</strong>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
                        <IconActivity size={18} />
                    </div>
                    <div className="metric-data">
                        <span>用户记忆</span>
                        <strong>{(status.resources?.memories ?? 0).toLocaleString()}</strong>
                    </div>
                </div>

                <div className="metric-card">
                    <div className="metric-icon bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                        <IconSmile size={18} />
                    </div>
                    <div className="metric-data">
                        <span>已收录表情</span>
                        <strong>{(status.resources?.stickers ?? 0).toLocaleString()}</strong>
                    </div>
                </div>
            </div>

            {/* Two Column details: Queues and Runtime stats */}
            <div className="two-column">
                <Panel title="处理队列状态" description="会话内串行处理以保序，不同会话在并发上限内并行。">
                    <div className="queue-grid">
                        <div className="queue-box">
                            <span className="queue-label">正在思考</span>
                            <strong className="queue-val text-blue-600 dark:text-blue-400">{status.activeBatches}</strong>
                            <small className="text-muted">个活跃并发任务</small>
                        </div>
                        <div className="queue-box">
                            <span className="queue-label">等待就绪</span>
                            <strong className="queue-val text-slate-700 dark:text-slate-300">{status.queuedBatches}</strong>
                            <small className="text-muted">个排队消息批次</small>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-line text-xs text-muted">
                        <div className="flex items-center gap-2">
                            <span>系统状态：</span>
                            <Badge tone={status.ready ? 'good' : 'warn'}>
                                {status.ready ? '正常运行' : '等待就绪'}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                            <IconDatabase size={13} />
                            <span>当前驱动：{status.database}</span>
                        </div>
                    </div>
                </Panel>

                <Panel
                    title="运行时健康度"
                    description="只展示非敏感系统状态，不包含聊天正文或密钥。"
                    actions={
                        <Button onClick={onRefresh}>
                            <IconRefresh size={13} />
                            <span>刷新</span>
                        </Button>
                    }
                >
                    <dl className="detail-list">
                        <div>
                            <dt>累计处理批次</dt>
                            <dd>{status.stats.processed.toLocaleString()}</dd>
                        </div>
                        <div>
                            <dt>累计发送回复</dt>
                            <dd>{status.stats.replies.toLocaleString()}</dd>
                        </div>
                        <div>
                            <dt>持续运行时长</dt>
                            <dd className="flex items-center gap-1.5">
                                <IconClock size={13} className="text-muted" />
                                {formatUptime(status.uptime)}
                            </dd>
                        </div>
                        <div>
                            <dt>已配置模型方案</dt>
                            <dd className="flex items-center gap-1.5">
                                <IconPlugin size={13} className="text-muted" />
                                {config?.providers.length ?? 0} 个
                            </dd>
                        </div>
                    </dl>
                </Panel>
            </div>
        </div>
    )
}

function formatUptime(ms: number): string {
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes} 分钟`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时 ${minutes % 60} 分钟`
    return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}
