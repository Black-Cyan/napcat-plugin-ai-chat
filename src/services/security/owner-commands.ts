import { randomInt, randomUUID } from 'node:crypto';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import type { ChatMessage, Conversation } from '../../types';
import { normalizeSubjectId } from '../../types';
import type { NormalizedIncoming } from '../../napcat/message-segments';
import { normalizeSegments, textSegment } from '../../napcat/message-segments';
import { getMessage, sendMessage } from '../../napcat/actions';
import { AccessControlService } from './access-control-service';
import { StickerService } from '../stickers/sticker-service';

interface PendingDeletion {
    token: string;
    type: 'user' | 'group';
    id: string;
    expiresAt: number;
}

export class OwnerCommandService {
    private readonly pending = new Map<string, PendingDeletion>();

    constructor(
        private readonly store: Store,
        private readonly accessControl: AccessControlService,
        private readonly stickers: StickerService,
    ) {}

    async handle(incoming: NormalizedIncoming, conversation: Conversation): Promise<boolean> {
        if (incoming.type !== 'private' || !pluginState.config.owners.includes(incoming.userId)) return false;
        const text = incoming.segments.filter((segment) => segment.type === 'text')
            .map((segment) => String(segment.data.text ?? '')).join('').trim();
        if (!text.startsWith(pluginState.config.commandPrefix)) return false;
        const body = text.slice(pluginState.config.commandPrefix.length).trim();
        const [command = '', ...args] = body.split(/\s+/);
        try {
            const response = await this.execute(command, args, incoming, conversation);
            await sendMessage(pluginState.ctx, conversation, [textSegment(response)]);
        } catch (error) {
            await sendMessage(pluginState.ctx, conversation, [textSegment(error instanceof Error ? error.message : '指令执行失败')]);
        }
        return true;
    }

    private async execute(command: string, args: string[], incoming: NormalizedIncoming, conversation: Conversation): Promise<string> {
        if (command === '帮助') return [
            '#帮助',
            '#运行模式 [黑名单|白名单]',
            '#拉黑用户 <QQ>', '#解除拉黑用户 <QQ>',
            '#拉黑群 <群号>', '#解除拉黑群 <群号>',
            '#允许用户 <QQ>', '#解除允许用户 <QQ>',
            '#允许群 <群号>', '#解除允许群 <群号>',
            '#拉黑用户 <QQ> 删除 / #拉黑群 <群号> 删除（需确认）',
            '#确认 <令牌>',
            '回复表情后发送 #收藏表情',
            '#启用 / #停用',
        ].join('\n');

        if (command === '启用' || command === '停用') {
            pluginState.updateConfig({ enabled: command === '启用' });
            return command === '启用' ? '已启用机器人响应' : '已停用机器人响应，消息保留规则不变';
        }

        if (command === '运行模式') {
            const modeArg = args[0]?.trim();
            if (modeArg === '黑名单') {
                await this.accessControl.setMode('blacklist');
                return '已切换为黑名单模式（未配置黑名单时默认允许所有消息）';
            }
            if (modeArg === '白名单') {
                await this.accessControl.setMode('whitelist');
                return '已切换为白名单模式（未配置白名单时默认禁用所有消息）';
            }
            const currentSnapshot = this.accessControl.getSnapshot();
            return `当前运行模式：${currentSnapshot?.mode === 'whitelist' ? '白名单模式' : '黑名单模式'}`;
        }

        if (command === '确认') {
            const pending = this.pending.get(incoming.userId);
            if (!pending || pending.expiresAt < Date.now() || pending.token !== args[0]) throw new Error('确认令牌无效或已过期');
            this.pending.delete(incoming.userId);
            if (pending.type === 'user') await this.store.deleteUserData(pending.id);
            else {
                const target = await this.store.ensureConversation('group', pending.id);
                await this.store.deleteConversation(target.id);
            }
            return '相关既有数据已删除';
        }

        if (command === '收藏表情') {
            if (!incoming.repliedMessageId) throw new Error('请先回复要收藏的图片或表情消息');
            const source = await getMessage(pluginState.ctx, incoming.repliedMessageId);
            const sourceUser = String(source.user_id ?? source.sender?.user_id ?? '');
            if (sourceUser && !this.accessControl.isAllowed(sourceUser, conversation.type === 'group' ? conversation.targetId : undefined)) {
                throw new Error('不能处理非允许来源的消息');
            }
            const segments = normalizeSegments(source.message, source.raw_message);
            const segment = segments.find((item) => item.type === 'image' || item.type === 'mface');
            if (!segment) throw new Error('回复消息中没有可收藏的图片或表情');
            const synthetic: ChatMessage = {
                id: randomUUID(), conversationId: conversation.id, seq: 0, batchId: null,
                napcatMessageId: incoming.repliedMessageId, senderId: sourceUser || null,
                senderName: source.sender?.nickname ?? '所有者', senderKind: 'human', role: 'user',
                content: segments, rawEvent: source, occurredAt: Date.now(), receivedAt: Date.now(),
            };
            const sticker = await this.stickers.collect(conversation, synthetic, segment, true);
            return `已收藏：${sticker.summary}`;
        }

        const matchBlacklist = /^(拉黑|解除拉黑)(用户|群)$/.exec(command);
        if (matchBlacklist) {
            const rawId = args[0];
            const normId = normalizeSubjectId(rawId);
            const remove = matchBlacklist[1] === '解除拉黑';
            const type = matchBlacklist[2] === '用户' ? ('user' as const) : ('group' as const);

            if (!remove && type === 'user' && pluginState.config.owners.length <= 1 && pluginState.config.owners[0] === normId) {
                throw new Error('不能拉黑最后一个所有者');
            }

            if (remove) {
                const state = await this.store.getAccessControlState();
                if (state.activeBlacklistId) {
                    await this.store.removeAccessListMember(state.activeBlacklistId, type, normId);
                }
                await this.accessControl.refresh();
                return '已从黑名单中移除';
            }

            const listId = await this.store.ensureActiveList('blacklist', '默认黑名单');
            await this.store.addAccessListMembers(listId, [{ subjectType: type, subjectId: normId }]);
            await this.accessControl.refresh();

            if (args[1] === '删除') {
                const token = String(randomInt(100000, 1000000));
                this.pending.set(incoming.userId, { token, type, id: normId, expiresAt: Date.now() + 60000 });
                return `已拉黑。60 秒内发送 #确认 ${token} 删除既有数据，否则保留。`;
            }
            return '已加入黑名单';
        }

        const matchWhitelist = /^(允许|解除允许)(用户|群)$/.exec(command);
        if (matchWhitelist) {
            const rawId = args[0];
            const normId = normalizeSubjectId(rawId);
            const remove = matchWhitelist[1] === '解除允许';
            const type = matchWhitelist[2] === '用户' ? ('user' as const) : ('group' as const);

            if (remove) {
                const state = await this.store.getAccessControlState();
                if (state.activeWhitelistId) {
                    await this.store.removeAccessListMember(state.activeWhitelistId, type, normId);
                }
                await this.accessControl.refresh();
                return '已从白名单中移除';
            }

            const listId = await this.store.ensureActiveList('whitelist', '默认白名单');
            await this.store.addAccessListMembers(listId, [{ subjectType: type, subjectId: normId }]);
            await this.accessControl.refresh();

            return '已加入白名单';
        }

        return '未知指令。发送 #帮助 查看可用指令。';
    }
}
