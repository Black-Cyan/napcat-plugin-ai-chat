import { z } from 'zod';
import type { ProviderToolCall, ProviderToolDefinition } from '../../providers/types';
import { textPart } from '../../providers/types';
import { Store } from '../../database/store';
import type { ChatMessage, Conversation } from '../../types';
import { ParticipantAliases } from './participants';
import { deleteMessage, setMessageEmojiLike } from '../../napcat/actions';
import { pluginState } from '../../core/state';
import { StickerService } from '../stickers/sticker-service';
import { SpeechService } from '../speech/speech-service';
import { speechSendDisabled } from './config';

const recallSchema = z.object({ message_id: z.string().min(1) }).strict();
const reactSchema = z.object({ message_id: z.string().min(1), emoji_id: z.string().min(1).max(32) }).strict();
const stickerSchema = z.object({ sticker_id: z.string().uuid() }).strict();
const collectSchema = z.object({ message_id: z.string().min(1) }).strict();
const voiceSchema = z.object({ text: z.string().min(1).max(5000) }).strict();

export class ToolBroker {
    constructor(private readonly store: Store, private readonly stickers: StickerService, private readonly speech: SpeechService) {}

    definitions(enabled: boolean, conversation?: Conversation): ProviderToolDefinition[] {
        if (!enabled) return [];
        return [
            {
                name: 'recall_message',
                description: '撤回当前会话中本机器人自己发送的一条消息。',
                parameters: objectSchema({ message_id: { type: 'string' } }, ['message_id']),
            },
            {
                name: 'react_message',
                description: '为当前批次中的一条消息添加 QQ 表情回应。',
                parameters: objectSchema({ message_id: { type: 'string' }, emoji_id: { type: 'string' } }, ['message_id', 'emoji_id']),
            },
            {
                name: 'send_sticker',
                description: '发送一个已经收藏且安全可用的表情包。',
                parameters: objectSchema({ sticker_id: { type: 'string' } }, ['sticker_id']),
            },
            ...(conversation && this.speech.ttsProfile(conversation) && !speechSendDisabled(conversation) ? [{
                name: 'send_voice',
                description: '把一段文字用配置的 TTS 模型合成为语音并发送到当前会话。仅适合简短、适合朗读的内容；发送失败会自动回退为文字。返回 sent_as=record 即表示语音已真实发出，不要再对参与者声称无法发送语音。',
                parameters: objectSchema({ text: { type: 'string' } }, ['text']),
            }] : []),
            {
                name: 'collect_sticker',
                description: '把当前批次某条消息中的图片或商城表情交给视觉模型理解，由它判断是否值得收藏并生成摘要与标签；判定为不值得收藏时会返回不收藏，仅在你认为值得收藏时调用。',
                parameters: objectSchema({ message_id: { type: 'string' } }, ['message_id']),
            },
        ];
    }

    async catalog(): Promise<string> {
        const stickers = await this.store.listStickers();
        const available = stickers.filter((sticker) => sticker.enabled && sticker.safetyStatus === 'safe')
            .sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)).slice(0, 60)
            .map((sticker) => ({ id: sticker.id, summary: sticker.summary, tags: sticker.tags, seen: sticker.seenCount, used: sticker.useCount }));
        return available.length ? `可发送的表情包（按语境自然选择，避免重复）：\n${JSON.stringify(available)}` : '';
    }

    async execute(
        conversation: Conversation,
        messages: ChatMessage[],
        aliases: ParticipantAliases,
        batchId: string,
        invocationId: string,
        call: ProviderToolCall,
    ): Promise<{ content: ReturnType<typeof textPart>[]; toolName: string }> {
        const key = `${batchId}:${invocationId}:${call.id}`;
        const begin = await this.store.beginTool(key, conversation.id, call.name, call.arguments);
        if (begin.duplicate) return toolResult(call.name, begin.result ?? '该工具已执行或仍在执行，未重复操作');
        try {
            const result = await this.perform(conversation, messages, aliases, call);
            await this.store.finishTool(key, 'completed', result);
            return toolResult(call.name, result);
        } catch (error) {
            const result = { error: safeError(error) };
            await this.store.finishTool(key, 'failed', result);
            return toolResult(call.name, result);
        }
    }

    private async perform(conversation: Conversation, messages: ChatMessage[], aliases: ParticipantAliases, call: ProviderToolCall): Promise<unknown> {
        if (call.name === 'recall_message') {
            const args = recallSchema.parse(call.arguments);
            if (!messages.some((message) => message.napcatMessageId === args.message_id)) {
                const own = await this.store.isOwnMessage(conversation.id, args.message_id);
                if (!own) throw new Error('只能撤回当前会话中机器人自己的消息');
            } else if (!await this.store.isOwnMessage(conversation.id, args.message_id)) {
                throw new Error('只能撤回机器人自己的消息');
            }
            await deleteMessage(pluginState.ctx, args.message_id);
            return { ok: true };
        }
        if (call.name === 'react_message') {
            const args = reactSchema.parse(call.arguments);
            if (!messages.some((message) => message.napcatMessageId === args.message_id)) throw new Error('只能回应当前批次中的消息');
            await setMessageEmojiLike(pluginState.ctx, args.message_id, args.emoji_id);
            return { ok: true };
        }
        if (call.name === 'send_sticker') {
            const args = stickerSchema.parse(call.arguments);
            const messageId = await this.stickers.send(conversation, args.sticker_id);
            await this.store.appendMessage({
                conversationId: conversation.id, napcatMessageId: messageId, senderId: pluginState.selfId || null,
                senderName: pluginState.selfName || 'assistant', senderKind: 'self', role: 'assistant',
                content: [{ type: 'image', data: { sticker_id: args.sticker_id, sub_type: 7 } }], rawEvent: { tool: 'send_sticker' },
                occurredAt: Date.now(), batch: false,
            });
            return { ok: true, message_id: messageId };
        }
        if (call.name === 'send_voice') {
            if (speechSendDisabled(conversation)) throw new Error('当前会话已禁用语音发送');
            const args = voiceSchema.parse(call.arguments);
            const result = await this.speech.sendVoice(conversation, args.text);
            await this.store.appendMessage({
                conversationId: conversation.id, napcatMessageId: result.messageId, senderId: pluginState.selfId || null,
                senderName: pluginState.selfName || 'assistant', senderKind: 'self', role: 'assistant',
                content: result.fallback
                    ? [{ type: 'text', data: { text: args.text } }]
                    : [{ type: 'record', data: { synthesized: true } }],
                rawEvent: { tool: 'send_voice', fallback: result.fallback }, occurredAt: Date.now(), batch: false,
            });
            return result.fallback
                ? { ok: true, fallback: 'text', message_id: result.messageId, note: '语音发送失败，已改为文字发送' }
                : {
                    ok: true,
                    message_id: result.messageId,
                    sent_as: 'record',
                    cached: result.cached,
                    note: '语音已合成并以语音消息发送成功。之后不要再声称自己无法发送语音。',
                };
        }
        if (call.name === 'collect_sticker') {
            const args = collectSchema.parse(call.arguments);
            const message = messages.find((item) => item.napcatMessageId === args.message_id || item.id === args.message_id);
            const segment = message?.content.find((item) => item.type === 'image' || item.type === 'mface');
            if (!message || !segment) throw new Error('当前批次中找不到该图片');
            const sticker = await this.stickers.collect(conversation, message, segment);
            return { ok: true, sticker_id: sticker.id, summary: sticker.summary };
        }
        throw new Error('未知工具');
    }
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
    return { type: 'object', properties, required, additionalProperties: false };
}

function toolResult(name: string, result: unknown) {
    return { content: [textPart(JSON.stringify(result))], toolName: name };
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 300) : '工具执行失败';
}
