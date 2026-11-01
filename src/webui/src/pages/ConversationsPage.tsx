import { useState } from 'react'
import { useResource } from '../hooks/useResource'
import { apiData, postJson } from '../utils/api'
import type { BehaviorConfig, ChatMessage, Conversation, PluginConfig, PromptProfile, SpeechConfig, StickerConfig } from '../types'
import { Notice, Badge, Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Select, Toggle } from '../components/ui'
import { PopoverMenu, SidePanel, useConfirm } from '../components/Overlay'

export default function ConversationsPage() {
    const [search, setSearch] = useState('')
    const { data, loading, error, refresh } = useResource<Conversation[]>(`/conversations?search=${encodeURIComponent(search)}`)
    const { data: config } = useResource<PluginConfig>('/config')
    const { data: prompts } = useResource<PromptProfile[]>('/prompts')
    const ask = useConfirm()
    const [selected, setSelected] = useState<Conversation | null>(null)
    const [title, setTitle] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [providerId, setProviderId] = useState<string | null>(null)
    const [promptId, setPromptId] = useState<string | null>(null)
    const [behaviorOverrides, setBehaviorOverrides] = useState<Partial<BehaviorConfig>>({})
    const [vision, setVision] = useState<boolean | undefined>(undefined)
    const [stickerOverrides, setStickerOverrides] = useState<Partial<StickerConfig>>({})
    const [speechOverrides, setSpeechOverrides] = useState<Partial<SpeechConfig> & { sendVoice?: boolean }>({})
    const [messages, setMessages] = useState<ChatMessage[] | null>(null)
    const [notice, setNotice] = useState('')
    const choose = (conversation: Conversation) => {
        setSelected(conversation); setTitle(conversation.title)
        setEnabled(conversation.override.enabled ?? true)
        setProviderId(conversation.providerProfileId ?? conversation.override.providerProfileId ?? null)
        setPromptId(conversation.promptProfileId ?? conversation.override.promptProfileId ?? null)
        setBehaviorOverrides(conversation.override.behavior ?? {})
        setVision(conversation.override.vision)
        setStickerOverrides(conversation.override.stickers ?? {})
        setSpeechOverrides(conversation.override.speech ?? {})
        setMessages(null); setNotice('')
    }
    const save = async (reset = false) => {
        if (!selected) return
        try {
            await postJson(`/conversations/${selected.id}/config`, reset ? {
                title, enabled: undefined, behavior: {}, vision: undefined, stickers: {}, promptProfileId: null, providerProfileId: null,
            } : {
                title, enabled, promptProfileId: promptId, providerProfileId: providerId,
                behavior: behaviorOverrides, vision, stickers: stickerOverrides, speech: speechOverrides,
            })
            setNotice(reset ? '已恢复继承全局配置' : '会话配置已保存'); await refresh()
        } catch (reason) { setNotice(reason instanceof Error ? reason.message : '保存失败') }
    }
    const loadMessages = async () => {
        if (!selected) return
        try { setMessages(await apiData<ChatMessage[]>(`/conversations/${selected.id}/messages`)) }
        catch (reason) { setNotice(reason instanceof Error ? reason.message : '历史加载失败') }
    }
    const remove = async () => {
        if (!selected || !await ask({ title: `永久删除会话“${selected.title}”？`, description: '将同时删除该会话的原始消息与历史摘要，此操作不可撤销。' })) return
        try { await postJson(`/conversations/${selected.id}/delete`, {}); setSelected(null); setMessages(null); await refresh() }
        catch (reason) { setNotice(reason instanceof Error ? reason.message : '删除失败') }
    }
    return <div className="page-stack">
        <ErrorNotice message={error} /><Notice message={notice} />
        <div>
            <Panel title="会话" description="私聊与群聊拥有完全隔离的历史和摘要。">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称或会话标识" />
                {loading && !data ? <Loading /> : <div className="resource-list">{data?.map((conversation) => <div key={conversation.id} className={`resource-row object-row ${selected?.id === conversation.id ? 'selected' : ''}`}>
                    <button type="button" className="object-main resource-row-button" onClick={() => choose(conversation)}>
                        <strong>{conversation.title}</strong><small>{conversation.targetId}</small>
                    </button>
                    <Badge>{conversation.type === 'group' ? '群聊' : '私聊'}</Badge>
                    <PopoverMenu actions={[
                        { label: '配置', onSelect: () => choose(conversation) },
                        { label: '读取最近 500 条消息', onSelect: () => { choose(conversation); setTimeout(() => void loadMessages(), 0) } },
                        { label: '删除会话数据', danger: true, onSelect: () => { choose(conversation); setTimeout(() => void remove(), 0) } },
                    ]} />
                </div>)}</div>}
            </Panel>
            {selected && <SidePanel
                title={selected.title}
                subtitle={`${selected.type === 'group' ? '群聊' : '私聊'} · ${selected.targetId}；留空表示继承全局配置`}
                onClose={() => setSelected(null)}
                footer={<>
                    <Button variant="danger" onClick={() => void remove()}>永久删除会话数据</Button>
                    <div className="flex items-center gap-2">
                        <Button onClick={() => void save(true)}>恢复全局继承</Button>
                        <Button variant="primary" onClick={() => void save()}>保存会话配置</Button>
                    </div>
                </>}
            >
                <Panel>
                    <div className="form-grid">
                        <Field label="显示名称"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                        <Field label="独立参与意愿"><NumberInput min="0" max="1" step="0.05" value={behaviorOverrides.engagement ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, engagement: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                        <Field label="提示词方案"><Select value={promptId ?? ''} onChange={(e) => setPromptId(e.target.value || null)}><option value="">全局默认</option>{prompts?.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}</Select></Field>
                        <Field label="聊天模型"><Select value={providerId ?? ''} onChange={(e) => setProviderId(e.target.value || null)}><option value="">全局默认</option>{config?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select></Field>
                        <Field label="独立输入 token 上限"><NumberInput min="0" value={behaviorOverrides.maxInputTokens ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, maxInputTokens: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                        <Field label="静默等待（毫秒）"><NumberInput value={behaviorOverrides.quietMs ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, quietMs: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                        <Field label="最长等待（毫秒）"><NumberInput value={behaviorOverrides.maxWaitMs ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, maxWaitMs: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                        <Field label="单批消息上限"><NumberInput value={behaviorOverrides.maxBatchMessages ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, maxBatchMessages: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                        <Field label="近期原始消息数"><NumberInput value={behaviorOverrides.recentMessageCount ?? ''} placeholder="继承全局" onChange={(e) => setBehaviorOverrides({ ...behaviorOverrides, recentMessageCount: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
                    </div>
                    <Toggle checked={enabled} onChange={setEnabled} label="允许此会话响应" />
                    <Toggle checked={vision ?? true} onChange={(value) => setVision(value)} label="允许理解图片内容" />
                    <Toggle checked={stickerOverrides.autoCollect ?? config?.stickers.autoCollect ?? true} onChange={(autoCollect) => setStickerOverrides({ ...stickerOverrides, autoCollect })} label="允许此会话自动收藏表情" />
                    <Toggle checked={stickerOverrides.autoSend ?? config?.stickers.autoSend ?? true} onChange={(autoSend) => setStickerOverrides({ ...stickerOverrides, autoSend })} label="允许此会话自动发送表情" />
                    <Toggle checked={speechOverrides.transcribe ?? config?.speech.transcribe ?? true} onChange={(transcribe) => setSpeechOverrides({ ...speechOverrides, transcribe })} label="允许此会话转写语音消息" />
                    <Toggle checked={speechOverrides.sendVoice ?? true} onChange={(sendVoice) => setSpeechOverrides({ ...speechOverrides, sendVoice })} label="允许此会话发送语音" />
                </Panel>
                <Panel title="原始消息" description="默认折叠，仅用于审计。" actions={<Button onClick={() => void loadMessages()}>读取最近 500 条</Button>}>
                    {messages ? (
                        <div className="message-history">
                            {messages.map((message) => {
                                const isBot = message.role === 'assistant'
                                return (
                                    <div key={message.id} className={`message-bubble ${isBot ? 'assistant' : ''}`}>
                                        <div className="message-meta">
                                            <Badge tone={isBot ? 'good' : message.senderKind === 'bot' ? 'warn' : 'neutral'}>
                                                {isBot ? '机器人回复' : message.senderKind === 'bot' ? '第三方Bot' : '用户'}
                                            </Badge>
                                            <span>#{message.seq}</span>
                                            <strong>{message.senderName}</strong>
                                            {message.occurredAt && (
                                                <span className="text-muted ml-auto">
                                                    {new Date(message.occurredAt).toLocaleTimeString()}
                                                </span>
                                            )}
                                        </div>
                                        <p className="message-text">{messageText(message)}</p>
                                    </div>
                                )
                            })}
                            {messages.length === 0 && <p className="muted text-xs p-2">此会话暂无聊天消息记录。</p>}
                        </div>
                    ) : (
                        <p className="muted">聊天内容包含会话敏感信息，默认折叠。点击右上角“读取最近 500 条”即可加载。</p>
                    )}
                </Panel>
            </SidePanel>}
        </div>
    </div>
}

function messageText(message: ChatMessage): string {
    return message.content.map((segment) => segment.type === 'text' ? String(segment.data.text ?? '') : `[${segment.type}]`).join('')
}
