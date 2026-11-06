import { randomInt, randomUUID } from 'node:crypto';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import type { Conversation } from '../../types';
import { normalizeSubjectId } from '../../types';
import type { NormalizedIncoming } from '../../napcat/message-segments';
import { atSegment, textSegment } from '../../napcat/message-segments';
import { sendMessage, getMessage } from '../../napcat/actions';
import { normalizeSegments } from '../../napcat/message-segments';
import type { ChatMessage } from '../../types';
import { AccessControlService } from '../security/access-control-service';
import { StickerService } from '../stickers/sticker-service';
import { SpeechService } from '../speech/speech-service';
import { SocialService } from '../social/social-service';
import { runtimeLogs } from '../../core/log-buffer';

interface PendingConfirmation {
    token: string;
    userId: string;
    conversationId: string;
    type: 'delete_user' | 'delete_group' | 'reset_social';
    targetId: string;
    expiresAt: number;
}

export class CommandService {
    private readonly pending = new Map<string, PendingConfirmation>();
    private readonly groupRateLimits = new Map<string, number>();

    constructor(
        private readonly store: Store,
        private readonly accessControl: AccessControlService,
        private readonly stickers: StickerService,
        private readonly speech?: SpeechService,
        private readonly social?: SocialService,
    ) {}

    async handle(incoming: NormalizedIncoming, conversation: Conversation): Promise<boolean> {
        const prefix = pluginState.config.commandPrefix || '#';
        const text = incoming.segments
            .filter((segment) => segment.type === 'text')
            .map((segment) => String(segment.data.text ?? ''))
            .join('')
            .trim();

        // 严格仅支持半角前缀，非前缀直接交回正常对话
        if (!text.startsWith(prefix)) return false;

        const body = text.slice(prefix.length).trim();
        if (!body) return false;

        const [rootCmd = '', ...restArgs] = body.split(/\s+/);
        const isOwner = pluginState.config.owners.includes(incoming.userId);
        const isGroup = incoming.type === 'group';

        try {
            const reply = await this.dispatch(rootCmd, restArgs, incoming, conversation, isOwner, isGroup);
            if (reply !== null) {
                if (reply.length > 0) {
                    await sendMessage(pluginState.ctx, conversation, reply);
                }
                return true;
            }
            // 未识别指令时静默放行给聊天处理
            return false;
        } catch (error) {
            // 权限不足或非所有者探测在群聊中一律绝对静默
            if (!isOwner && isGroup) {
                if (pluginState.config.debug) {
                    runtimeLogs.add('warn', `群聊静默拦截非法或未知指令: ${text} by ${incoming.userId}`, 'access');
                }
                return false;
            }
            const errText = error instanceof Error ? error.message : '指令执行失败';
            await sendMessage(pluginState.ctx, conversation, [textSegment(errText)]);
            return true;
        }
    }

    private async dispatch(
        root: string,
        args: string[],
        incoming: NormalizedIncoming,
        conversation: Conversation,
        isOwner: boolean,
        isGroup: boolean,
    ): Promise<Array<ReturnType<typeof textSegment> | ReturnType<typeof atSegment>> | null> {
        // ==================== 1. 帮助指令 (#帮助) ====================
        if (root === '帮助') {
            const sub = args[0]?.trim();
            if (!isOwner) {
                if (sub === '社交') {
                    return [textSegment([
                        '#社交 指令说明：',
                        '#社交 - 查看自身好感度与熟识等级（群聊中带冷却限制）',
                    ].join('\n'))];
                }
                return [textSegment([
                    '可用指令：',
                    '#帮助 [社交] - 查看指定指令帮助',
                    '#社交 - 查询自身好感度与熟识等级',
                ].join('\n'))];
            }

            // 所有者展示分级指令树
            if (sub === '社交') {
                return [textSegment([
                    '#社交 指令：',
                    '#社交 - 查询自身状态',
                    '#社交 查 <QQ/@> - 查看指定用户社交关系',
                    '#社交 调好感 <QQ/@> <+/-数值> - 调整好感度',
                    '#社交 调熟识 <QQ/@> <+/-经验> - 调整经验值',
                    '#社交 重置 <QQ/@> - 重置用户关系数据（需确认）',
                    '#社交 统计 - 关系数据总览',
                ].join('\n'))];
            }
            if (sub === '名单') {
                return [textSegment([
                    '#名单 指令：',
                    '#名单 模式 [黑名单|白名单] - 查询或切换运行模式',
                    '#名单 拉黑 <用户|群> <ID/@> [删除] - 加入黑名单',
                    '#名单 解黑 <用户|群> <ID/@> - 移出黑名单',
                    '#名单 允许 <用户|群> <ID/@> - 加入白名单',
                    '#名单 解允 <用户|群> <ID/@> - 移出白名单',
                ].join('\n'))];
            }
            if (sub === '会话') {
                return [textSegment([
                    '#会话 指令：',
                    '#会话 重置摘要 [群号|QQ] - 清空历史摘要游标，保留原始消息',
                ].join('\n'))];
            }
            if (sub === '系统') {
                return [textSegment([
                    '#系统 指令：',
                    '#系统 启用 - 开启机器人响应',
                    '#系统 停用 - 暂停机器人响应',
                ].join('\n'))];
            }

            return [textSegment([
                '所有者指令目录：',
                '#帮助 [社交|名单|会话|系统] - 查看对应模块',
                '#社交 - 社交关系管理',
                '#名单 - 访问控制名单管理',
                '#会话 - 聊天历史与摘要',
                '#系统 - 机器人启停',
                '#表情 收藏（或 #收藏表情）- 回复表情消息后收藏',
                '#语音 <文本> - 发送合成语音',
                '#确认 <6位令牌> - 确认高危操作',
            ].join('\n'))];
        }

        // ==================== 2. 社交命名空间 (#社交) ====================
        if (root === '社交') {
            const sub = args[0]?.trim();
            const botId = pluginState.selfId || 'default-bot';

            // 自查：普通用户或所有者直接输入 #社交
            if (!sub || sub === '我的') {
                if (isGroup) {
                    const now = Date.now();
                    const key = `${incoming.targetId}:${incoming.userId}`;
                    const last = this.groupRateLimits.get(key) ?? 0;
                    if (now - last < 60000) {
                        // 60s 冷却期内静默防刷 (处理成功但不再重复发消息)
                        return [];
                    }
                    this.groupRateLimits.set(key, now);
                }

                const internalId = await this.store.getOrCreateUserIdentity('qq', incoming.userId);
                const rel = await this.store.getOrCreateSocialRelation(botId, internalId);

                if (isGroup) {
                    return [
                        atSegment(incoming.userId),
                        textSegment(` 好感度: ${rel.affection} | 熟识度: Lv${rel.familiarityLevel} (${rel.familiarityExp} Exp)`),
                    ];
                }
                return [textSegment(`当前社交状态：\n好感度: ${rel.affection}\n熟识度: Lv${rel.familiarityLevel} (${rel.familiarityExp} Exp)`)];
            }

            // 以下子命令仅限所有者
            if (!isOwner) {
                if (isGroup) return null; // 群内绝对静默
                throw new Error('无权执行该指令');
            }

            if (sub === '查') {
                const target = this.resolveTargetId(args[1], incoming);
                if (!target) throw new Error('用法：#社交 查 <QQ号或@某人>');
                const internalId = await this.store.getOrCreateUserIdentity('qq', target);
                const rel = await this.store.getOrCreateSocialRelation(botId, internalId);
                return [textSegment(`用户 ${target} 社交档案：\n好感度: ${rel.affection}\n熟识等级: Lv${rel.familiarityLevel} (总经验: ${rel.familiarityExp})\n内部ID: ${internalId.slice(0, 8)}...`)];
            }

            if (sub === '调好感') {
                const at = incoming.segments.find((s) => s.type === 'at');
                const target = at?.data?.qq ? normalizeSubjectId(String(at.data.qq)) : (args[1]?.match(/^\d+$/) ? normalizeSubjectId(args[1]) : null);
                const deltaStr = at?.data?.qq ? args[1]?.trim() : args[2]?.trim();
                const delta = Number(deltaStr);
                if (!target || isNaN(delta)) throw new Error('用法：#社交 调好感 <QQ/@> <+/-数值>');
                const internalId = await this.store.getOrCreateUserIdentity('qq', target);
                const updated = await this.store.applySocialEvent({
                    botId,
                    userId: internalId,
                    eventType: 'admin_adjust',
                    affectionDelta: delta,
                    reason: '所有者指令调整好感',
                });
                return [textSegment(`已调整用户 ${target} 好感度 (当前: ${updated.affection})`)];
            }

            if (sub === '调熟识') {
                const at = incoming.segments.find((s) => s.type === 'at');
                const target = at?.data?.qq ? normalizeSubjectId(String(at.data.qq)) : (args[1]?.match(/^\d+$/) ? normalizeSubjectId(args[1]) : null);
                const deltaStr = at?.data?.qq ? args[1]?.trim() : args[2]?.trim();
                const delta = Number(deltaStr);
                if (!target || isNaN(delta)) throw new Error('用法：#社交 调熟识 <QQ/@> <+/-经验>');
                const internalId = await this.store.getOrCreateUserIdentity('qq', target);
                const updated = await this.store.applySocialEvent({
                    botId,
                    userId: internalId,
                    eventType: 'admin_adjust',
                    expDelta: delta,
                    reason: '所有者指令调整经验',
                });
                return [textSegment(`已调整用户 ${target} 熟识度 (当前: Lv${updated.familiarityLevel}, ${updated.familiarityExp} Exp)`)];
            }

            if (sub === '重置') {
                const target = this.resolveTargetId(args[1], incoming);
                if (!target) throw new Error('用法：#社交 重置 <QQ号或@某人>');
                const token = String(randomInt(100000, 1000000));
                this.pending.set(token, {
                    token,
                    userId: incoming.userId,
                    conversationId: conversation.id,
                    type: 'reset_social',
                    targetId: target,
                    expiresAt: Date.now() + 60000,
                });
                return [textSegment(`⚠️ 即将清空目标 ${target} 的全部好感度与熟识度！此操作不可逆。\n请在 60 秒内发送：#确认 ${token}`)];
            }

            if (sub === '统计') {
                const total = await this.store.countSocialRelations(botId);
                return [textSegment(`当前机器人已追踪建立关系的用户数：${total} 人`)];
            }

            throw new Error('未知社交子命令。发送 #帮助 社交 查看用法。');
        }

        // ==================== 3. 访问控制名单命名空间 (#名单) ====================
        if (root === '名单') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const sub = args[0]?.trim();

            if (sub === '模式') {
                const modeArg = args[1]?.trim();
                if (modeArg === '黑名单') {
                    await this.accessControl.setMode('blacklist');
                    return [textSegment('已切换为黑名单模式（未配置黑名单时默认允许所有消息）')];
                }
                if (modeArg === '白名单') {
                    await this.accessControl.setMode('whitelist');
                    return [textSegment('已切换为白名单模式（未配置白名单时默认禁用所有消息）')];
                }
                const currentSnapshot = this.accessControl.getSnapshot();
                return [textSegment(`当前运行模式：${currentSnapshot?.mode === 'whitelist' ? '白名单模式' : '黑名单模式'}`)];
            }

            const isAdd = sub === '拉黑' || sub === '允许';
            const isRemove = sub === '解黑' || sub === '解除拉黑' || sub === '解允' || sub === '解除允许';

            if (isAdd || isRemove) {
                const typeStr = args[1]?.trim();
                const type = typeStr === '用户' ? ('user' as const) : typeStr === '群' ? ('group' as const) : null;
                const target = this.resolveTargetId(args[2], incoming);
                if (!type || !target) throw new Error(`用法：#名单 ${sub} <用户|群> <ID或@>`);

                const isBlack = sub === '拉黑' || sub === '解黑' || sub === '解除拉黑';

                if (isAdd && type === 'user' && pluginState.config.owners.length <= 1 && pluginState.config.owners[0] === target) {
                    throw new Error('不能拉黑最后一个所有者');
                }

                if (isRemove) {
                    const state = await this.store.getAccessControlState();
                    const listId = isBlack ? state.activeBlacklistId : state.activeWhitelistId;
                    if (listId) {
                        await this.store.removeAccessListMember(listId, type, target);
                    }
                    await this.accessControl.refresh();
                    return [textSegment(`已从${isBlack ? '黑' : '白'}名单中移除`)];
                }

                const listId = await this.store.ensureActiveList(isBlack ? 'blacklist' : 'whitelist', isBlack ? '默认黑名单' : '默认白名单');
                await this.store.addAccessListMembers(listId, [{ subjectType: type, subjectId: target }]);
                await this.accessControl.refresh();

                if (args[3] === '删除') {
                    const token = String(randomInt(100000, 1000000));
                    this.pending.set(token, {
                        token,
                        userId: incoming.userId,
                        conversationId: conversation.id,
                        type: type === 'user' ? 'delete_user' : 'delete_group',
                        targetId: target,
                        expiresAt: Date.now() + 60000,
                    });
                    return [textSegment(`已拉黑。60 秒内发送 #确认 ${token} 删除既有数据，否则保留。`)];
                }
                return [textSegment(`已加入${isBlack ? '黑' : '白'}名单`)];
            }

            throw new Error('未知名单子命令。发送 #帮助 名单 查看用法。');
        }

        // ==================== 4. 会话管理命名空间 (#会话) ====================
        if (root === '会话' || root === '重置摘要') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const isDirectReset = root === '重置摘要';
            const sub = isDirectReset ? '重置摘要' : args[0]?.trim();
            const targetArg = isDirectReset ? args[0]?.trim() : args[1]?.trim();

            if (sub === '重置摘要') {
                const rawTarget = targetArg;
                if (rawTarget) {
                    const normId = normalizeSubjectId(rawTarget);
                    const targetConv = await this.store.findConversationByTargetId(normId);
                    if (!targetConv) throw new Error(`未找到目标 ${rawTarget} 的会话数据`);
                    await this.store.resetSummary(targetConv.id);
                    return [textSegment(`已重置会话“${targetConv.title}”的历史摘要，原始消息已保留`)];
                }
                await this.store.resetSummary(conversation.id);
                return [textSegment('已重置当前会话的历史摘要，原始消息已保留')];
            }

            throw new Error('未知会话子命令。发送 #帮助 会话 查看用法。');
        }

        // ==================== 5. 系统控制命名空间 (#系统) ====================
        if (root === '系统') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const sub = args[0]?.trim();
            if (sub === '启用' || sub === '停用') {
                pluginState.updateConfig({ enabled: sub === '启用' });
                return [textSegment(sub === '启用' ? '已启用机器人响应' : '已停用机器人响应，消息保留规则不变')];
            }
            throw new Error('用法：#系统 启用 或 #系统 停用');
        }

        // ==================== 6. 表情管理 (#表情 / #收藏表情) ====================
        if (root === '表情' || root === '收藏表情') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const sub = root === '收藏表情' ? '收藏' : args[0]?.trim();
            if (sub === '收藏') {
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
                    id: randomUUID(),
                    conversationId: conversation.id,
                    seq: 0,
                    batchId: null,
                    napcatMessageId: incoming.repliedMessageId,
                    senderId: sourceUser || null,
                    senderName: source.sender?.nickname ?? '所有者',
                    senderKind: 'human',
                    role: 'user',
                    content: segments,
                    rawEvent: source,
                    occurredAt: Date.now(),
                    receivedAt: Date.now(),
                };
                const sticker = await this.stickers.collect(conversation, synthetic, segment, true);
                return [textSegment(`已收藏表情：${sticker.summary}`)];
            }
            throw new Error('用法：#表情 收藏（回复目标图片或表情）');
        }

        // ==================== 7. 语音发送 (#语音) ====================
        if (root === '语音') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const content = args.join(' ').trim();
            if (!content) throw new Error('用法：#语音 <要朗读的文本>');
            if (!this.speech) throw new Error('语音功能未就绪');
            const result = await this.speech.sendVoice(conversation, content);
            return [textSegment(result.fallback ? '语音发送失败，已改为文字发送' : '语音已发送')];
        }

        // ==================== 8. 两阶段高危确认 (#确认 <token>) ====================
        if (root === '确认') {
            if (!isOwner) return isGroup ? null : [textSegment('无权执行该指令')];
            const token = args[0]?.trim();
            const pending = token ? this.pending.get(token) : null;

            // 严格防线：校验令牌有效性、发起人ID与发起会话ID
            if (!pending || pending.expiresAt < Date.now() || pending.userId !== incoming.userId || pending.conversationId !== conversation.id) {
                this.pending.delete(token || '');
                throw new Error('确认令牌无效、已过期，或非发起者本人在原会话中确认');
            }

            this.pending.delete(token);

            if (pending.type === 'delete_user') {
                await this.store.deleteUserData(pending.targetId);
                return [textSegment(`已删除用户 ${pending.targetId} 的全部既有数据`)];
            }
            if (pending.type === 'delete_group') {
                const target = await this.store.ensureConversation('group', pending.targetId);
                await this.store.deleteConversation(target.id);
                return [textSegment(`已删除群聊 ${pending.targetId} 的全部既有数据`)];
            }
            if (pending.type === 'reset_social') {
                const botId = pluginState.selfId || 'default-bot';
                const internalId = await this.store.getOrCreateUserIdentity('qq', pending.targetId);
                await this.store.resetSocialRelation(botId, internalId, '所有者指令两阶段确认重置');
                return [textSegment(`已重置用户 ${pending.targetId} 的全部社交关系数据`)];
            }

            return [textSegment('已完成确认操作')];
        }

        // 未知指令：群聊中静默忽略，私聊中给出提示
        if (isGroup) return null;
        throw new Error('未知指令。发送 #帮助 查看可用指令。');
    }

    private resolveTargetId(arg: string | undefined, incoming: NormalizedIncoming): string | null {
        if (arg) {
            const m = arg.match(/^\d+$/);
            if (m) return normalizeSubjectId(arg);
        }
        const at = incoming.segments.find((s) => s.type === 'at');
        if (at?.data?.qq) {
            return normalizeSubjectId(String(at.data.qq));
        }
        return null;
    }
}
