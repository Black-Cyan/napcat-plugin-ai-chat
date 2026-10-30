import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import { ProviderError, textPart, type ProviderMessage } from '../../providers/types';
import { ProviderRegistry } from '../../providers/registry';
import type { ChatMessage, Conversation, MessageSegment } from '../../types';
import { sendMessage } from '../../napcat/actions';
import { atSegment, textSegment } from '../../napcat/message-segments';
import { ContextComposer } from '../context/context-composer';
import { MemoryService } from '../memory/memory-service';
import { StickerService } from '../stickers/sticker-service';
import { conversationEnabled, effectiveBehavior, effectiveProviderId, effectiveVision } from './config';
import { ParticipantAliases } from './participants';
import { ParticipationService } from './participation';
import { ToolBroker } from './tool-broker';
import { ResponseGuard } from '../security/response-guard';
import { AccessControlService } from '../security/access-control-service';
import { safeDiagnostic } from '../../core/diagnostics';
import { runtimeLogs } from '../../core/log-buffer';

export class ChatOrchestrator {
    private readonly backgroundChains = new Map<string, Promise<void>>();

    constructor(
        private readonly store: Store,
        private readonly providers: ProviderRegistry,
        private readonly context: ContextComposer,
        private readonly memories: MemoryService,
        private readonly stickers: StickerService,
        private readonly tools: ToolBroker,
        private readonly participation: ParticipationService,
        private readonly accessControl?: AccessControlService,
        private readonly responseGuard: ResponseGuard = new ResponseGuard(),
    ) {}

    private isAllowed(conversation: Conversation): boolean {
        if (!this.accessControl) return true;
        return this.accessControl.isAllowed(
            conversation.type === 'private' ? conversation.targetId : '',
            conversation.type === 'group' ? conversation.targetId : undefined,
        );
    }

    async process(batchId: string): Promise<void> {
        if (!await this.store.claimBatch(batchId)) return;
        let conversation: Conversation | null = null;
        let messages: ChatMessage[] = [];
        try {
            const batch = await this.store.getBatch(batchId);
            if (!batch) return;
            conversation = await this.store.getConversation(batch.conversationId);
            if (!conversation || !conversationEnabled(conversation) || !this.isAllowed(conversation)) {
                await this.store.finishBatch(batchId, 'skipped');
                return;
            }
            messages = await this.store.getBatchMessages(batchId);
            if (!messages.length) {
                await this.store.finishBatch(batchId, 'completed');
                return;
            }
            const decision = await this.participation.shouldRespond(conversation, messages);
            if (!decision.respond) {
                await this.store.finishBatch(batchId, 'skipped');
                await this.participation.noteOutcome(conversation, messages, false, decision.botOnly);
                this.runBackgroundTasks(conversation, messages, new ParticipantAliases(messages));
                return;
            }
            const profile = this.providers.profile(effectiveProviderId(conversation));
            const aliases = new ParticipantAliases(messages);
            const images = profile.vision && effectiveVision(conversation)
                ? await this.stickers.visionParts(messages, pluginState.config.stickers.maxImageBytes)
                : [];
            let reduction = 0;
            let sideEffects = false;
            let composed = await this.context.compose(conversation, messages, aliases, profile, images, reduction);
            const catalog = await this.tools.catalog();
            if (catalog && composed.messages[0]) composed.messages[0].content.push(textPart(`\n${catalog}`));
            let providerMessages: ProviderMessage[] = composed.messages;
            const behavior = effectiveBehavior(conversation);
            while (true) {
                if (!this.isAllowed(conversation)) {
                    await this.store.finishBatch(batchId, 'skipped');
                    return;
                }
                if (pluginState.config.debug) {
                    runtimeLogs.add('debug', `发起模型请求 [${profile.name}] (${conversation.title})`, 'model', {
                        model: profile.model,
                        conversationId: conversation.id,
                        messages: providerMessages,
                        tools: this.tools.definitions(profile.toolCalling),
                    });
                }
                let response;
                try {
                    response = await this.providers.generate(profile, {
                        profile,
                        messages: providerMessages,
                        tools: this.tools.definitions(profile.toolCalling),
                        stream: true,
                    });
                } catch (error) {
                    if (error instanceof ProviderError && error.contextOverflow && !sideEffects && reduction < behavior.maxContextRetries) {
                        reduction += 1;
                        composed = await this.context.compose(conversation, messages, aliases, profile, images, reduction, false);
                        providerMessages = composed.messages;
                        continue;
                    }
                    throw error;
                }
                if (pluginState.config.debug) {
                    runtimeLogs.add('debug', `收到模型响应 [${profile.name}] (${conversation.title})`, 'model', {
                        text: response.text,
                        toolCalls: response.toolCalls,
                        usage: response.usage,
                        finishReason: response.finishReason,
                    });
                }
                if (response.toolCalls.length && profile.toolCalling) {
                    sideEffects = true;
                    providerMessages = [...providerMessages, {
                        role: 'assistant', content: response.text ? [textPart(response.text)] : [], toolCalls: response.toolCalls, raw: response.raw,
                    }];
                    for (let index = 0; index < response.toolCalls.length; index += 1) {
                        if (!this.isAllowed(conversation)) {
                            await this.store.finishBatch(batchId, 'skipped');
                            return;
                        }
                        const call = response.toolCalls[index];
                        const result = await this.tools.execute(conversation, messages, aliases, batchId, `${reduction}:${providerMessages.length}:${index}`, call);
                        if (pluginState.config.debug) {
                            runtimeLogs.add('debug', `执行工具 [${call.name}] (${conversation.title})`, 'tool', {
                                tool: call.name,
                                arguments: call.arguments,
                                result: result.content,
                            });
                        }
                        providerMessages.push({
                            role: 'tool', content: result.content, toolCallId: call.id, toolName: result.toolName, raw: call.raw,
                        });
                    }
                    continue;
                }
                if (!this.isAllowed(conversation)) {
                    await this.store.finishBatch(batchId, 'skipped');
                    return;
                }
                const safeText = this.responseGuard.sanitize(response.text, conversation, composed.memories);
                const sent = await this.sendReply(conversation, safeText, aliases);
                await this.store.finishBatch(batchId, 'completed');
                await this.participation.noteOutcome(conversation, messages, sent > 0, decision.botOnly);
                await this.store.markMemoriesUsed(composed.memories.map((memory) => memory.id));
                pluginState.incrementProcessed(sent > 0);
                if (sent > 0 || response.text.trim() === 'NO_REPLY') {
                    this.runBackgroundTasks(conversation, messages, aliases);
                }
                return;
            }
        } catch (error) {
            const diagnostic = safeDiagnostic(error);
            runtimeLogs.add('warn', `消息批次处理失败：${diagnostic}`);
            pluginState.logger.warn('消息批次处理失败');
            await this.store.finishBatch(batchId, 'failed', diagnostic);
        }
    }

    async drain(): Promise<void> {
        await Promise.allSettled([...this.backgroundChains.values()]);
    }

    private runBackgroundTasks(conversation: Conversation, messages: ChatMessage[], aliases: ParticipantAliases): void {
        if (!this.isAllowed(conversation)) return;
        const previous = this.backgroundChains.get(conversation.id) ?? Promise.resolve();
        const task = previous.then(async () => {
            if (!this.isAllowed(conversation)) return;
            const results = await Promise.allSettled([
                this.memories.updateFromBatch(conversation, messages, aliases),
                this.stickers.processBatch(conversation, messages),
            ]);
            if (results.some((result) => result.status === 'rejected')) pluginState.logger.debug('部分后台记忆或表情任务失败，原始消息未受影响');
        });
        this.backgroundChains.set(conversation.id, task);
        void task.finally(() => {
            if (this.backgroundChains.get(conversation.id) === task) this.backgroundChains.delete(conversation.id);
        });
    }

    private async sendReply(conversation: Conversation, text: string, aliases: ParticipantAliases): Promise<number> {
        if (text.trim() === 'NO_REPLY' || !text.trim()) return 0;
        const parts = splitReply(text);
        let sent = 0;
        for (const part of parts) {
            const content = renderMentions(part, aliases);
            if (!content.length) continue;
            const result = await sendMessage(pluginState.ctx, conversation, content);
            await this.store.appendMessage({
                conversationId: conversation.id,
                napcatMessageId: result.messageId,
                senderId: pluginState.selfId || null,
                senderName: pluginState.selfName || 'assistant',
                senderKind: 'self', role: 'assistant', content,
                rawEvent: { generated: true }, occurredAt: Date.now(), batch: false,
            });
            sent += 1;
        }
        if (pluginState.config.debug && sent > 0) {
            runtimeLogs.add('debug', `发送回复 [${conversation.title}] (${sent} 条)`, 'chat', {
                conversationId: conversation.id,
                parts,
            });
        }
        return sent;
    }
}

export function splitReply(text: string): string[] {
    const normalized = text.replace(/\r/g, '').trim();
    const paragraphs = normalized.split(/\n\s*\n+/).flatMap((part) => part.split(/\n?\[\[SPLIT\]\]\n?/i));
    const output: string[] = [];
    for (const paragraph of paragraphs) {
        let remaining = paragraph.trim();
        while (remaining.length > 800 && output.length < 3) {
            const boundary = Math.max(remaining.lastIndexOf('。', 800), remaining.lastIndexOf('\n', 800), remaining.lastIndexOf(' ', 800));
            const cut = boundary > 200 ? boundary + 1 : 800;
            output.push(remaining.slice(0, cut).trim());
            remaining = remaining.slice(cut).trim();
        }
        if (remaining && output.length < 3) output.push(remaining);
        if (output.length >= 3) break;
    }
    return output.filter(Boolean);
}

function renderMentions(text: string, aliases: ParticipantAliases): MessageSegment[] {
    const output: MessageSegment[] = [];
    let cursor = 0;
    for (const match of text.matchAll(/@(p\d+)/g)) {
        const index = match.index ?? 0;
        const qq = aliases.id(match[1]);
        if (!qq) continue;
        if (index > cursor) output.push(textSegment(text.slice(cursor, index).trimStart()));
        output.push(atSegment(qq));
        output.push(textSegment(' '));
        cursor = index + match[0].length;
    }
    if (cursor < text.length) output.push(textSegment(text.slice(cursor)));
    return output.filter((segment) => segment.type !== 'text' || String(segment.data.text ?? '').trim().length > 0);
}
