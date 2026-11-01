import { useConfig } from '../hooks/useConfig'
import { Notice, Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Toggle } from '../components/ui'
import type { BehaviorConfig, SpeechConfig, StickerConfig } from '../types'

export default function BehaviorPage() {
    const { config, setConfig, saving, error, notice, save } = useConfig()
    if (!config) return <><ErrorNotice message={error} /><Loading label="正在读取行为配置" /></>
    const behavior = (patch: Partial<BehaviorConfig>) => setConfig({ ...config, behavior: { ...config.behavior, ...patch } })
    const stickers = (patch: Partial<StickerConfig>) => setConfig({ ...config, stickers: { ...config.stickers, ...patch } })
    const speech = (patch: Partial<SpeechConfig>) => config && setConfig({ ...config, speech: { ...config.speech, ...patch } })
    return <div className="page-stack">
        <ErrorNotice message={error} /><Notice message={notice} />
        <Panel title="参与对话的方式" description="参与度只决定何时说话；人格与语气由提示词方案控制。">
            <div className="form-grid">
                <Field label="默认参与意愿" hint="0 仅回应明显提及，1 最热情；默认 0.7。">
                    <NumberInput min="0" max="1" step="0.05" value={config.behavior.engagement} onChange={(e) => behavior({ engagement: Number(e.target.value) })} />
                </Field>
                <Field label="回复冷却（毫秒）" hint="两次回复之间的最小间隔，避免连续刷屏。"><NumberInput value={config.behavior.replyCooldownMs} onChange={(e) => behavior({ replyCooldownMs: Number(e.target.value) })} /></Field>
                <Field label="同一来源冷处理阈值" hint="单批超过该消息数时，可以忽略一轮。"><NumberInput value={config.behavior.sameSourceBurstThreshold} onChange={(e) => behavior({ sameSourceBurstThreshold: Number(e.target.value) })} /></Field>
                <Field label="机器人往返保护" hint="与其他机器人连续对话的最大轮次，超过后暂停回应，防止无限互答。"><NumberInput min="1" value={config.behavior.botRoundLimit} onChange={(e) => behavior({ botRoundLimit: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="消息批次" description="新消息会重新计算静默窗口，但不会超过最长等待。">
            <div className="form-grid">
                <Field label="静默等待（毫秒）" hint="收到新消息后等待多久再打包处理；新消息会重新计时。"><NumberInput value={config.behavior.quietMs} onChange={(e) => behavior({ quietMs: Number(e.target.value) })} /></Field>
                <Field label="最长等待（毫秒）" hint="无论是否还有新消息，超过该时间都会立即处理当前批次。"><NumberInput value={config.behavior.maxWaitMs} onChange={(e) => behavior({ maxWaitMs: Number(e.target.value) })} /></Field>
                <Field label="单批最多消息" hint="一次提交给模型的消息条数上限，超出部分留到下一批。"><NumberInput value={config.behavior.maxBatchMessages} onChange={(e) => behavior({ maxBatchMessages: Number(e.target.value) })} /></Field>
                <Field label="跨会话并行任务" hint="同时处理的会话数量；同一会话内始终串行。"><NumberInput value={config.behavior.maxConcurrentTasks} onChange={(e) => behavior({ maxConcurrentTasks: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="上下文预算" description="原始消息永久保留，预算只影响单次发给模型的内容。">
            <div className="form-grid">
                <Field label="近期原始消息数" hint="每次请求附带的最近原文条数，更早的内容由摘要替代。"><NumberInput value={config.behavior.recentMessageCount} onChange={(e) => behavior({ recentMessageCount: Number(e.target.value) })} /></Field>
                <Field label="默认输入 token 上限" hint="0 表示按模型实际上限与下方比例计算。"><NumberInput min="0" value={config.behavior.maxInputTokens} onChange={(e) => behavior({ maxInputTokens: Number(e.target.value) })} /></Field>
                <Field label="模型上限的输入比例" hint="输入预算占模型上下文的比例，剩余空间留给输出与安全余量。"><NumberInput step="0.05" min="0.1" max="0.95" value={config.behavior.inputBudgetRatio} onChange={(e) => behavior({ inputBudgetRatio: Number(e.target.value) })} /></Field>
                <Field label="压缩触发比例" hint="估算输入超过预算的该比例时，先压缩较早历史再发送。"><NumberInput step="0.05" min="0.1" max="1" value={config.behavior.compressionTriggerRatio} onChange={(e) => behavior({ compressionTriggerRatio: Number(e.target.value) })} /></Field>
                <Field label="超限额外重试" hint="因上下文超限失败时，缩减内容后允许的重试次数。"><NumberInput min="0" max="5" value={config.behavior.maxContextRetries} onChange={(e) => behavior({ maxContextRetries: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="图片与表情包" description="来源不限制传播范围；理解失败或安全判断不确定时跳过。">
            <Toggle checked={config.stickers.enabled} onChange={(enabled) => stickers({ enabled })} label="启用表情包功能" hint="关闭后不再理解、收藏或发送表情。" />
            <Toggle checked={config.stickers.autoCollect} onChange={(autoCollect) => stickers({ autoCollect })} label="允许模型自动收藏" hint="由视觉模型判断图片是否值得入库，已收藏的直接复用。" />
            <Toggle checked={config.stickers.autoSend} onChange={(autoSend) => stickers({ autoSend })} label="允许模型自主发送" hint="开放 send_sticker 工具，模型可按语境发送已收藏表情。" />
            <div className="form-grid compact-top">
                <Field label="单张图片字节上限" hint="超过该大小的图片不下载、不送入模型。"><NumberInput value={config.stickers.maxImageBytes} onChange={(e) => stickers({ maxImageBytes: Number(e.target.value) })} /></Field>
                <Field label="媒体缓存（MB）" hint="收藏图片的本地缓存上限，达到上限后停止新增收藏。"><NumberInput value={config.stickers.cacheLimitMb} onChange={(e) => stickers({ cacheLimitMb: Number(e.target.value) })} /></Field>
                <Field label="不收藏冷却（天）" hint="判定为不值得收藏的图片在冷却期内不再送模型评估；0 表示每次都重新评估，不安全内容永久跳过。">
                    <NumberInput min="0" max="365" value={config.stickers.rejectionCooldownDays} onChange={(e) => stickers({ rejectionCooldownDays: Number(e.target.value) })} />
                </Field>
            </div>
        </Panel>
        <Panel title="语音" description="配置 TTS 模型即提供语音工具，会话可单独禁用。">
            <Toggle checked={config.speech.transcribe} onChange={(transcribe) => speech({ transcribe })} label="自动转写收到的语音消息" hint="使用语音转写模型把语音转成文字后再参与对话。" />
            <div className="form-grid compact-top">
                <Field label="语音文本上限（字）" hint="单次合成的最大字数，超出时要求模型缩短。"><NumberInput min="1" max="5000" value={config.speech.maxTtsTextLength} onChange={(e) => speech({ maxTtsTextLength: Number(e.target.value) })} /></Field>
                <Field label="合成语音时长上限（秒）" hint="合成结果超过该时长则判定失败，需要本机 ffprobe 才能测量。"><NumberInput min="1" max="600" value={config.speech.maxTtsSeconds} onChange={(e) => speech({ maxTtsSeconds: Number(e.target.value) })} /></Field>
                <Field label="转写语音时长上限（秒）" hint="超过该时长的语音不转写，只在对话中标注。"><NumberInput min="1" max="3600" value={config.speech.maxTranscribeSeconds} onChange={(e) => speech({ maxTranscribeSeconds: Number(e.target.value) })} /></Field>
                <Field label="语音缓存（MB）" hint="合成音频的本地缓存上限，超出后按最久未用清理。"><NumberInput min="1" value={config.speech.cacheLimitMb} onChange={(e) => speech({ cacheLimitMb: Number(e.target.value) })} /></Field>
            </div>
        </Panel>
        <Panel title="时间" description="消息附带时间与长间隔标记。">
            <Field label="时区" hint="默认 Asia/Shanghai；留空则跟随 NapCat 运行环境的时区。" wide>
                <Input value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} placeholder="Asia/Shanghai" />
            </Field>
        </Panel>
        <Panel title="所有者与运行" description="所有者指令仅在私聊中由确定性解析器处理。">
            <Field label="所有者 QQ 号" hint="多个账号用空格或换行分隔。" wide><TextAreaOwners value={config.owners} onChange={(owners) => setConfig({ ...config, owners })} /></Field>
            <Toggle checked={config.enabled} onChange={(enabled) => setConfig({ ...config, enabled })} label="允许机器人响应" hint="总开关，关闭后仅记录消息，不再生成回复。" />
            <Toggle checked={config.debug} onChange={(debug) => setConfig({ ...config, debug })} label="输出脱敏调试日志" hint="记录原始消息、提示词与模型返回，密钥始终脱敏。" />
        </Panel>
        <div className="sticky-save"><Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? '正在保存' : '保存行为配置'}</Button></div>
    </div>
}

function TextAreaOwners({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
    return <textarea className="input textarea" rows={3} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split(/[\s,，]+/).filter(Boolean))} />
}
