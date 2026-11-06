import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import type { ChatMessage, Conversation, UserSocialRelation } from '../../types';
import { ParticipantAliases } from '../chat/participants';
import { AITasks } from '../ai/tasks';
import { runtimeLogs } from '../../core/log-buffer';

export class SocialService {
    constructor(
        private readonly store: Store,
        private readonly tasks: AITasks,
    ) {}

    async getBatchSocialProfiles(botId: string, externalIds: string[]): Promise<Map<string, UserSocialRelation>> {
        const result = new Map<string, UserSocialRelation>();
        if (!pluginState.config.social.enabled || !externalIds.length) return result;
        const targetBotId = botId || pluginState.selfId || 'default-bot';

        for (const extId of externalIds) {
            try {
                const internalId = await this.store.getOrCreateUserIdentity('qq', extId);
                const relation = await this.store.getOrCreateSocialRelation(targetBotId, internalId);
                result.set(extId, relation);
            } catch {
                // 单个用户查询失败不中断批次
            }
        }
        return result;
    }

    async processBatch(conversation: Conversation, messages: ChatMessage[], aliases: ParticipantAliases): Promise<void> {
        const config = pluginState.config.social;
        if (!config || !config.enabled) return;
        const botId = pluginState.selfId || 'default-bot';

        const candidates = messages.filter((m) => m.senderKind !== 'self' && m.senderId);
        if (!candidates.length) return;

        // 按发送者聚合批次内发言
        const userMessages = new Map<string, ChatMessage[]>();
        for (const m of candidates) {
            const list = userMessages.get(m.senderId!) ?? [];
            list.push(m);
            userMessages.set(m.senderId!, list);
        }

        const midnight = getMidnight(pluginState.config.timezone);

        for (const [senderId, msgs] of userMessages.entries()) {
            try {
                const texts = msgs.flatMap((m) => m.content.filter((c) => c.type === 'text').map((c) => String(c.data.text ?? '')));
                if (isSpam(texts)) continue;

                const internalId = await this.store.getOrCreateUserIdentity('qq', senderId);
                const relation = await this.store.getOrCreateSocialRelation(botId, internalId);

                const now = Date.now();
                // 1. 冷却时间校验：如果在冷却期内且有过既往互动，则跳过
                if (config.cooldownSeconds > 0 && relation.lastInteractedAt > 0) {
                    if (now - relation.lastInteractedAt < config.cooldownSeconds * 1000) {
                        continue;
                    }
                }

                // 2. 每日经验上限校验
                const dailyStats = await this.store.getDailySocialStats(botId, internalId, midnight);
                const expRemaining = Math.max(0, config.maxDailyExp - dailyStats.expDeltaSum);
                const expDelta = expRemaining > 0 ? 1 : 0;

                // 3. 好感度结算
                let affectionDelta = 0;
                let reason = '日常互动';
                let eventType: 'chat_rule' | 'ai_eval' = 'chat_rule';

                if (config.enableAiEvaluation && typeof this.tasks.evaluateInteraction === 'function') {
                    try {
                        const evalResult = await this.tasks.evaluateInteraction(texts.join(' '), conversation);
                        if (evalResult?.attitude === 'friendly' || evalResult?.attitude === 'supportive') {
                            const gainRoom = Math.max(0, config.maxDailyAffectionGain - dailyStats.affectionGainSum);
                            if (gainRoom > 0) {
                                affectionDelta = 1;
                                reason = '对话态度友好';
                                eventType = 'ai_eval';
                            }
                        } else if (evalResult?.attitude === 'hostile' || evalResult?.attitude === 'offensive') {
                            const lossRoom = Math.max(0, config.maxDailyAffectionLoss - dailyStats.affectionLossSum);
                            if (lossRoom > 0) {
                                affectionDelta = -Math.min(2, lossRoom);
                                reason = '对话含有攻击性或恶意';
                                eventType = 'ai_eval';
                            }
                        }
                    } catch {
                        // AI 评价失败降级为常规规则结算
                    }
                }

                if (expDelta === 0 && affectionDelta === 0) continue;

                await this.store.applySocialEvent({
                    botId,
                    userId: internalId,
                    eventType,
                    affectionDelta,
                    expDelta,
                    conversationId: conversation.id,
                    messageBatchId: msgs[0]?.batchId ?? null,
                    reason,
                    thresholds: config.familiarityThresholds,
                });

                if (pluginState.config.debug) {
                    runtimeLogs.add('debug', `结算社交关系 [QQ ${senderId}]: exp+${expDelta}, aff+${affectionDelta} (${reason})`, 'access', {
                        senderId, internalId, expDelta, affectionDelta, reason,
                    });
                }
            } catch (err) {
                // 社交结算故障不阻断任何聊天
                if (pluginState.config.debug) {
                    runtimeLogs.add('warn', `社交关系结算异常: ${err instanceof Error ? err.message : String(err)}`, 'access');
                }
            }
        }
    }
}

export function isSpam(texts: string[]): boolean {
    const combined = texts.join('').trim();
    if (!combined || combined.length <= 1) return true;
    // 纯标点符号或单字复读
    if (/^[\p{P}\p{S}\s\d]+$/u.test(combined)) return true;
    // 纯相同字符复读，如 "啊啊啊啊" 或 "哈哈哈哈"
    if (/^(.)\1{3,}$/u.test(combined)) return true;
    return false;
}

export function getMidnight(timezone = 'Asia/Shanghai'): number {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'Asia/Shanghai',
            year: 'numeric', month: 'numeric', day: 'numeric',
        });
        const parts = formatter.formatToParts(now);
        const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
        const m = parts.find((p) => p.type === 'month')?.value ?? '1';
        const d = parts.find((p) => p.type === 'day')?.value ?? '1';
        return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00+08:00`).getTime();
    } catch {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
}
