import { useConfig } from '../hooks/useConfig'
import { Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Toggle } from '../components/ui'
import type { BehaviorConfig, StickerConfig } from '../types'

export default function BehaviorPage() {
    const { config, setConfig, saving, error, notice, save } = useConfig()
    if (!config) return <><ErrorNotice message={error} /><Loading label="正在读取行为配置" /></>
    const behavior = (patch: Partial<BehaviorConfig>) => setConfig({ ...config, behavior: { ...config.behavior, ...patch } })
    const stickers = (patch: Partial<StickerConfig>) => setConfig({ ...config, stickers: { ...config.stickers, ...patch } })
    return <div className="page-stack">
        <ErrorNotice message={error} />{notice && <div className="notice">{notice}</div>}
        <Panel title="参与对话的方式" description="参与度只决定何时说话；人格与语气由提示词方案控制。">
            <div className="form-grid">
                <Field label="默认参与意愿" hint="0 仅回应明显提及，1 最热情；默认 0.7。">
                    <NumberInput min="0" max="1" step="0.05" value={config.behavior.engagement} onChange={(e) => behavior({ engagement: Number(e.target.value) })} />
                </Field>
                <Field label="回复冷却（毫秒）"><NumberInput value={config.behavior.replyCooldownMs} onChange={(e) => behavior({ replyCooldownMs: Number(e.target.value) })} /></Field>
                <Field label="同一来源冷处理阈值" hint="单批超过该消息数时，可以忽略一轮。"><NumberInput value={config.behavior.sameSourceBurstThreshold} onChange={(e) => behavior({ sameSourceBurstThreshold: Number(e.target.value) })} /></Field>
                <Field label="机器人往返保护"><NumberInput min="1" value={config.behavior.botRoundLimit} onChange={(e) => behavior({ botRoundLimit: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="消息批次" description="新消息会重新计算静默窗口，但不会超过最长等待。">
            <div className="form-grid">
                <Field label="静默等待（毫秒）"><NumberInput value={config.behavior.quietMs} onChange={(e) => behavior({ quietMs: Number(e.target.value) })} /></Field>
                <Field label="最长等待（毫秒）"><NumberInput value={config.behavior.maxWaitMs} onChange={(e) => behavior({ maxWaitMs: Number(e.target.value) })} /></Field>
                <Field label="单批最多消息"><NumberInput value={config.behavior.maxBatchMessages} onChange={(e) => behavior({ maxBatchMessages: Number(e.target.value) })} /></Field>
                <Field label="跨会话并行任务"><NumberInput value={config.behavior.maxConcurrentTasks} onChange={(e) => behavior({ maxConcurrentTasks: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="上下文预算" description="原始消息永久保留，预算只影响单次发给模型的内容。">
            <div className="form-grid">
                <Field label="近期原始消息数"><NumberInput value={config.behavior.recentMessageCount} onChange={(e) => behavior({ recentMessageCount: Number(e.target.value) })} /></Field>
                <Field label="默认输入 token 上限" hint="0 表示按模型实际上限与下方比例计算。"><NumberInput min="0" value={config.behavior.maxInputTokens} onChange={(e) => behavior({ maxInputTokens: Number(e.target.value) })} /></Field>
                <Field label="模型上限的输入比例"><NumberInput step="0.05" min="0.1" max="0.95" value={config.behavior.inputBudgetRatio} onChange={(e) => behavior({ inputBudgetRatio: Number(e.target.value) })} /></Field>
                <Field label="压缩触发比例"><NumberInput step="0.05" min="0.1" max="1" value={config.behavior.compressionTriggerRatio} onChange={(e) => behavior({ compressionTriggerRatio: Number(e.target.value) })} /></Field>
                <Field label="超限额外重试"><NumberInput min="0" max="5" value={config.behavior.maxContextRetries} onChange={(e) => behavior({ maxContextRetries: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="图片与表情包" description="来源不限制传播范围；理解失败或安全判断不确定时跳过。">
            <Toggle checked={config.stickers.enabled} onChange={(enabled) => stickers({ enabled })} label="启用表情包功能" />
            <Toggle checked={config.stickers.autoCollect} onChange={(autoCollect) => stickers({ autoCollect })} label="允许模型自动收藏" />
            <Toggle checked={config.stickers.autoSend} onChange={(autoSend) => stickers({ autoSend })} label="允许模型自主发送" />
            <div className="form-grid compact-top">
                <Field label="单张图片字节上限"><NumberInput value={config.stickers.maxImageBytes} onChange={(e) => stickers({ maxImageBytes: Number(e.target.value) })} /></Field>
                <Field label="媒体缓存（MB）"><NumberInput value={config.stickers.cacheLimitMb} onChange={(e) => stickers({ cacheLimitMb: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="所有者与运行" description="所有者指令仅在私聊中由确定性解析器处理。">
            <Field label="所有者 QQ 号" hint="多个账号用空格或换行分隔。" wide><TextAreaOwners value={config.owners} onChange={(owners) => setConfig({ ...config, owners })} /></Field>
            <Toggle checked={config.enabled} onChange={(enabled) => setConfig({ ...config, enabled })} label="允许机器人响应" />
            <Toggle checked={config.debug} onChange={(debug) => setConfig({ ...config, debug })} label="输出脱敏调试日志" />
        </Panel>
        <div className="sticky-save"><Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? '正在保存' : '保存行为配置'}</Button></div>
    </div>
}

function TextAreaOwners({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
    return <textarea className="input textarea" rows={3} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split(/[\s,，]+/).filter(Boolean))} />
}
