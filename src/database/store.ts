import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from './database';
import type { DatabaseSchema } from './schema';
import type { ConversationTable, MemoryTable, AccessListTable, AccessListMemberTable } from './schema';
import type {
    AccessControlState,
    AccessList,
    AccessListMember,
    AccessListType,
    AccessMode,
    AccessPolicySnapshot,
    AccessSubjectType,
    ChatMessage,
    Conversation,
    ConversationType,
    MemoryScope,
    MemoryUserSummary,
    MessageBatch,
    MessageSegment,
    PromptProfile,
    SenderKind,
    SessionOverride,
    Sticker,
    UserMemory,
    UserProfile,
} from '../types';
import { normalizeSubjectId } from '../types';

export interface AppendMessageInput {
    conversationId: string;
    napcatMessageId: string | null;
    senderId: string | null;
    senderName: string;
    senderKind: SenderKind;
    role: 'user' | 'assistant';
    content: MessageSegment[];
    rawEvent: unknown;
    occurredAt: number;
    batch: boolean;
}

export class Store {
    constructor(private readonly database: Database) {}

    private get db(): Kysely<DatabaseSchema> {
        return this.database.db;
    }

    async seed(): Promise<void> {
        const existing = await this.db.selectFrom('prompt_profiles').select('id').where('is_default', '=', 1).executeTakeFirst();
        if (!existing) {
            const now = Date.now();
            await this.db.insertInto('prompt_profiles').values({
                id: randomUUID(),
                name: '全局默认',
                content: '你是一个在 QQ 中自然参与聊天的 AI。回复简短、真诚，像熟悉群聊语境的朋友；不要假装自己是人类，被认真询问时如实说明自己是 AI。',
                is_default: 1,
                created_at: now,
                updated_at: now,
            }).execute();
        }
    }

    async ensureConversation(type: ConversationType, targetId: string, title = ''): Promise<Conversation> {
        const now = Date.now();
        await this.db.insertInto('conversations').values({
            id: randomUUID(), type, target_id: targetId, title: title || targetId, next_seq: 1,
            config_json: '{}', prompt_profile_id: null, provider_profile_id: null,
            bot_rounds: 0, created_at: now, updated_at: now,
        }).onConflict((conflict) => conflict.doNothing()).execute();
        const row = await this.db.selectFrom('conversations').selectAll()
            .where('type', '=', type).where('target_id', '=', targetId).executeTakeFirstOrThrow();
        return mapConversation(row);
    }

    async getConversation(id: string): Promise<Conversation | null> {
        const row = await this.db.selectFrom('conversations').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? mapConversation(row) : null;
    }

    async listConversations(search = ''): Promise<Conversation[]> {
        let query = this.db.selectFrom('conversations').selectAll();
        if (search) query = query.where((eb) => eb.or([
            eb('title', 'like', `%${search}%`), eb('target_id', 'like', `%${search}%`),
        ]));
        const rows = await query.orderBy('updated_at', 'desc').limit(500).execute();
        return rows.map(mapConversation);
    }

    async updateConversation(id: string, patch: {
        title?: string; override?: SessionOverride; promptProfileId?: string | null;
        providerProfileId?: string | null; botRounds?: number;
    }): Promise<void> {
        const values: Partial<ConversationTable> = { updated_at: Date.now() };
        if (patch.title !== undefined) values.title = patch.title;
        if (patch.override !== undefined) values.config_json = JSON.stringify(patch.override);
        if (patch.promptProfileId !== undefined) values.prompt_profile_id = patch.promptProfileId;
        if (patch.providerProfileId !== undefined) values.provider_profile_id = patch.providerProfileId;
        if (patch.botRounds !== undefined) values.bot_rounds = patch.botRounds;
        await this.db.updateTable('conversations').set(values).where('id', '=', id).execute();
    }

    async appendMessage(input: AppendMessageInput): Promise<{ message: ChatMessage; batch: MessageBatch | null; duplicate: boolean }> {
        if (input.napcatMessageId) {
            const duplicate = await this.db.selectFrom('messages').selectAll()
                .where('conversation_id', '=', input.conversationId)
                .where('napcat_message_id', '=', input.napcatMessageId).executeTakeFirst();
            if (duplicate) return { message: mapMessage(duplicate), batch: null, duplicate: true };
        }
        return this.db.transaction().execute(async (trx) => {
            await trx.updateTable('conversations')
                .set((eb) => ({ next_seq: eb('next_seq', '+', 1), updated_at: Date.now() }))
                .where('id', '=', input.conversationId).execute();
            const conversation = await trx.selectFrom('conversations').select('next_seq').where('id', '=', input.conversationId).executeTakeFirstOrThrow();
            const seq = Number(conversation.next_seq) - 1;
            const now = Date.now();
            if (input.senderId && input.senderKind !== 'self') {
                await trx.insertInto('user_profiles').values({
                    qq: input.senderId, display_name: input.senderName, address: '', address_manual: 0, created_at: now, updated_at: now,
                }).onConflict((conflict) => conflict.doNothing()).execute();
                await trx.updateTable('user_profiles').set({ display_name: input.senderName, updated_at: now }).where('qq', '=', input.senderId).execute();
            }
            let batchRow: BatchRow | undefined;
            if (input.batch) {
                batchRow = await trx.selectFrom('message_batches').selectAll()
                    .where('conversation_id', '=', input.conversationId).where('status', '=', 'pending')
                    .orderBy('first_message_at', 'desc').executeTakeFirst();
                if (batchRow) {
                    await trx.updateTable('message_batches').set((eb) => ({
                        end_seq: seq, message_count: eb('message_count', '+', 1), last_message_at: now,
                    })).where('id', '=', batchRow.id).execute();
                    batchRow = { ...batchRow, end_seq: seq, message_count: Number(batchRow.message_count) + 1, last_message_at: now };
                } else {
                    const id = randomUUID();
                    const values = {
                        id, conversation_id: input.conversationId, status: 'pending' as const,
                        start_seq: seq, end_seq: seq, message_count: 1,
                        first_message_at: now, last_message_at: now, attempts: 0, error: null,
                    };
                    await trx.insertInto('message_batches').values(values).execute();
                    batchRow = values;
                }
            }
            const values = {
                id: randomUUID(), conversation_id: input.conversationId, seq,
                batch_id: batchRow?.id ?? null, napcat_message_id: input.napcatMessageId,
                sender_id: input.senderId, sender_name: input.senderName, sender_kind: input.senderKind,
                role: input.role, content_json: JSON.stringify(input.content),
                raw_event_json: JSON.stringify(input.rawEvent ?? null),
                occurred_at: input.occurredAt, received_at: now,
            };
            await trx.insertInto('messages').values(values).execute();
            return {
                message: mapMessage(values),
                batch: batchRow ? mapBatch(batchRow) : null,
                duplicate: false,
            };
        });
    }

    async getBatch(id: string): Promise<MessageBatch | null> {
        const row = await this.db.selectFrom('message_batches').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? mapBatch(row) : null;
    }

    async getBatchMessages(id: string): Promise<ChatMessage[]> {
        const batch = await this.getBatch(id);
        const rows = await this.db.selectFrom('messages').selectAll().where('batch_id', '=', id).orderBy('seq', 'asc').execute();
        return this.filterModelMessages(batch?.conversationId, rows);
    }

    async closeBatch(id: string): Promise<void> {
        await this.db.updateTable('message_batches').set({ status: 'ready' }).where('id', '=', id).where('status', '=', 'pending').execute();
    }

    async claimBatch(id: string): Promise<boolean> {
        const result = await this.db.updateTable('message_batches').set((eb) => ({
            status: 'processing', attempts: eb('attempts', '+', 1), error: null,
        })).where('id', '=', id).where('status', 'in', ['ready', 'failed']).executeTakeFirst();
        return Number(result.numUpdatedRows) > 0;
    }

    async finishBatch(id: string, status: 'completed' | 'skipped' | 'failed', error?: string): Promise<void> {
        await this.db.updateTable('message_batches').set({ status, error: error?.slice(0, 500) ?? null }).where('id', '=', id).execute();
    }

    async listOpenBatches(): Promise<MessageBatch[]> {
        const rows = await this.db.selectFrom('message_batches').selectAll().where('status', 'in', ['pending', 'ready', 'failed']).orderBy('last_message_at', 'asc').limit(200).execute();
        return rows.map(mapBatch);
    }

    async recoverProcessingBatches(): Promise<void> {
        await this.db.updateTable('message_batches').set({ status: 'ready' }).where('status', '=', 'processing').execute();
    }

    async getRecentMessages(conversationId: string, beforeSeq: number, limit: number, forModel = true): Promise<ChatMessage[]> {
        const rows = await this.db.selectFrom('messages').selectAll().where('conversation_id', '=', conversationId)
            .where('seq', '<', beforeSeq).orderBy('seq', 'desc').limit(forModel ? Math.max(limit * 3, limit) : limit).execute();
        const filtered = forModel ? await this.filterModelMessages(conversationId, rows) : rows.map(mapMessage);
        return filtered.slice(0, limit).reverse();
    }

    async getMessagesThrough(conversationId: string, fromSeq: number, throughSeq: number): Promise<ChatMessage[]> {
        const rows = await this.db.selectFrom('messages').selectAll().where('conversation_id', '=', conversationId)
            .where('seq', '>=', fromSeq).where('seq', '<=', throughSeq).orderBy('seq', 'asc').execute();
        return this.filterModelMessages(conversationId, rows);
    }

    async getSummary(conversationId: string): Promise<{ content: string; coveredThroughSeq: number }> {
        const row = await this.db.selectFrom('conversation_summaries').selectAll().where('conversation_id', '=', conversationId).executeTakeFirst();
        return { content: row?.content ?? '', coveredThroughSeq: Number(row?.covered_through_seq ?? 0) };
    }

    async saveSummary(conversationId: string, content: string, expectedCoverage: number, newCoverage: number): Promise<boolean> {
        return this.db.transaction().execute(async (trx) => {
            const current = await trx.selectFrom('conversation_summaries').selectAll().where('conversation_id', '=', conversationId).executeTakeFirst();
            if (Number(current?.covered_through_seq ?? 0) !== expectedCoverage) return false;
            if (current) {
                await trx.updateTable('conversation_summaries').set({ content, covered_through_seq: newCoverage, updated_at: Date.now() }).where('conversation_id', '=', conversationId).execute();
            } else {
                await trx.insertInto('conversation_summaries').values({ conversation_id: conversationId, content, covered_through_seq: newCoverage, updated_at: Date.now() }).execute();
            }
            return true;
        });
    }

    async getPrompt(id: string | null): Promise<PromptProfile | null> {
        let query = this.db.selectFrom('prompt_profiles').selectAll();
        query = id ? query.where('id', '=', id) : query.where('is_default', '=', 1);
        const row = await query.executeTakeFirst();
        return row ? mapPrompt(row) : null;
    }

    async listPrompts(): Promise<PromptProfile[]> {
        const rows = await this.db.selectFrom('prompt_profiles').selectAll().orderBy('updated_at', 'desc').execute();
        return rows.map(mapPrompt);
    }

    async savePrompt(profile: Partial<PromptProfile> & Pick<PromptProfile, 'name' | 'content'>): Promise<PromptProfile> {
        const now = Date.now();
        const id = profile.id ?? randomUUID();
        if (profile.isDefault) await this.db.updateTable('prompt_profiles').set({ is_default: 0 }).execute();
        const existing = await this.getPrompt(id);
        if (existing) {
            await this.db.updateTable('prompt_profiles').set({
                name: profile.name, content: profile.content,
                is_default: profile.isDefault === undefined ? (existing.isDefault ? 1 : 0) : (profile.isDefault ? 1 : 0),
                updated_at: now,
            }).where('id', '=', id).execute();
        } else {
            await this.db.insertInto('prompt_profiles').values({
                id, name: profile.name, content: profile.content, is_default: profile.isDefault ? 1 : 0,
                created_at: now, updated_at: now,
            }).execute();
        }
        return (await this.getPrompt(id))!;
    }

    async deletePrompt(id: string): Promise<void> {
        await this.db.deleteFrom('prompt_profiles').where('id', '=', id).where('is_default', '=', 0).execute();
    }

    // ==================== Access Control ====================

    async getAccessControlState(): Promise<AccessControlState> {
        const mode = ((await this.database.getMetadata('access_mode')) as AccessMode) || 'whitelist';
        const activeBlacklistId = (await this.database.getMetadata('active_blacklist_id')) || null;
        const activeWhitelistId = (await this.database.getMetadata('active_whitelist_id')) || null;
        return {
            mode,
            activeBlacklistId: activeBlacklistId || null,
            activeWhitelistId: activeWhitelistId || null,
        };
    }

    async setAccessControlState(patch: Partial<AccessControlState>): Promise<AccessControlState> {
        const current = await this.getAccessControlState();
        const nextMode = patch.mode ?? current.mode;
        const nextBlacklist = patch.activeBlacklistId !== undefined ? (patch.activeBlacklistId || null) : current.activeBlacklistId;
        const nextWhitelist = patch.activeWhitelistId !== undefined ? (patch.activeWhitelistId || null) : current.activeWhitelistId;

        if (current.mode === 'blacklist' && nextMode === 'whitelist') {
            await this.db.updateTable('conversation_summaries').set({ content: '', covered_through_seq: 0, updated_at: Date.now() }).execute();
        }

        await this.database.setMetadata('access_mode', nextMode);
        await this.database.setMetadata('active_blacklist_id', nextBlacklist || '');
        await this.database.setMetadata('active_whitelist_id', nextWhitelist || '');

        return {
            mode: nextMode,
            activeBlacklistId: nextBlacklist,
            activeWhitelistId: nextWhitelist,
        };
    }

    async getAccessPolicySnapshot(): Promise<AccessPolicySnapshot> {
        const state = await this.getAccessControlState();
        let userBlacklist: string[] = [];
        let groupBlacklist: string[] = [];
        let activeBlacklistName: string | null = null;
        if (state.activeBlacklistId) {
            const list = await this.getAccessList(state.activeBlacklistId);
            if (list) {
                activeBlacklistName = list.name;
                const members = await this.listAccessListMembers(state.activeBlacklistId);
                userBlacklist = members.filter((m) => m.subjectType === 'user').map((m) => m.subjectId);
                groupBlacklist = members.filter((m) => m.subjectType === 'group').map((m) => m.subjectId);
            }
        }

        let userWhitelist: string[] = [];
        let groupWhitelist: string[] = [];
        let activeWhitelistName: string | null = null;
        if (state.activeWhitelistId) {
            const list = await this.getAccessList(state.activeWhitelistId);
            if (list) {
                activeWhitelistName = list.name;
                const members = await this.listAccessListMembers(state.activeWhitelistId);
                userWhitelist = members.filter((m) => m.subjectType === 'user').map((m) => m.subjectId);
                groupWhitelist = members.filter((m) => m.subjectType === 'group').map((m) => m.subjectId);
            }
        }

        return {
            mode: state.mode,
            activeBlacklistId: state.activeBlacklistId,
            activeWhitelistId: state.activeWhitelistId,
            activeBlacklistName,
            activeWhitelistName,
            userBlacklist,
            groupBlacklist,
            userWhitelist,
            groupWhitelist,
        };
    }

    async createAccessList(type: AccessListType, name: string, description = ''): Promise<AccessList> {
        const trimmedName = name.trim();
        if (!trimmedName) throw new Error('名单名称不能为空');
        const existing = await this.db.selectFrom('access_lists')
            .selectAll()
            .where('type', '=', type)
            .where('name', '=', trimmedName)
            .executeTakeFirst();
        if (existing) {
            throw new Error(`已存在同名的${type === 'blacklist' ? '黑名单' : '白名单'}：${trimmedName}`);
        }
        const now = Date.now();
        const id = randomUUID();
        await this.db.insertInto('access_lists').values({
            id,
            type,
            name: trimmedName,
            description: description.trim(),
            is_default: 0,
            created_at: now,
            updated_at: now,
        }).execute();
        return (await this.getAccessList(id))!;
    }

    async getAccessList(id: string): Promise<AccessList | null> {
        const row = await this.db.selectFrom('access_lists').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? mapAccessList(row) : null;
    }

    async listAccessLists(type?: AccessListType): Promise<AccessList[]> {
        let query = this.db.selectFrom('access_lists').selectAll();
        if (type) query = query.where('type', '=', type);
        const rows = await query.orderBy('created_at', 'asc').execute();
        return rows.map(mapAccessList);
    }

    async updateAccessList(id: string, patch: { name?: string; description?: string }): Promise<AccessList> {
        const current = await this.getAccessList(id);
        if (!current) throw new Error('名单不存在');
        const values: Partial<AccessListTable> = { updated_at: Date.now() };
        if (patch.name !== undefined) {
            const trimmedName = patch.name.trim();
            if (!trimmedName) throw new Error('名单名称不能为空');
            const duplicate = await this.db.selectFrom('access_lists')
                .selectAll()
                .where('type', '=', current.type)
                .where('name', '=', trimmedName)
                .where('id', '!=', id)
                .executeTakeFirst();
            if (duplicate) throw new Error(`已存在同名的${current.type === 'blacklist' ? '黑名单' : '白名单'}：${trimmedName}`);
            values.name = trimmedName;
        }
        if (patch.description !== undefined) {
            values.description = patch.description.trim();
        }
        await this.db.updateTable('access_lists').set(values).where('id', '=', id).execute();
        return (await this.getAccessList(id))!;
    }

    async deleteAccessList(id: string): Promise<void> {
        const current = await this.getAccessList(id);
        if (!current) return;
        if (current.isDefault) {
            throw new Error('默认名单不可删除');
        }
        const state = await this.getAccessControlState();
        if (current.type === 'blacklist' && state.activeBlacklistId === id) {
            await this.setAccessControlState({ activeBlacklistId: null });
        } else if (current.type === 'whitelist' && state.activeWhitelistId === id) {
            await this.setAccessControlState({ activeWhitelistId: null });
        }
        await this.db.deleteFrom('access_list_members').where('list_id', '=', id).execute();
        await this.db.deleteFrom('access_lists').where('id', '=', id).execute();
    }

    async duplicateAccessList(id: string, newName: string): Promise<AccessList> {
        const original = await this.getAccessList(id);
        if (!original) throw new Error('原名单不存在');
        const created = await this.createAccessList(original.type, newName, original.description ? `${original.description} (副本)` : '');
        const members = await this.listAccessListMembers(id);
        if (members.length) {
            await this.addAccessListMembers(created.id, members.map((m) => ({ subjectType: m.subjectType, subjectId: m.subjectId, note: m.note })));
        }
        return (await this.getAccessList(created.id))!;
    }

    async listAccessListMembers(listId: string): Promise<AccessListMember[]> {
        const rows = await this.db.selectFrom('access_list_members').selectAll().where('list_id', '=', listId).orderBy('created_at', 'desc').execute();
        return rows.map(mapAccessListMember);
    }

    async addAccessListMembers(
        listId: string,
        members: Array<{ subjectType: AccessSubjectType; subjectId: string; note?: string }>,
    ): Promise<{ added: number; skipped: number }> {
        const list = await this.getAccessList(listId);
        if (!list) throw new Error('目标名单不存在');
        const now = Date.now();
        let added = 0;
        let skipped = 0;
        const normalizedMembers: Array<{ subjectType: AccessSubjectType; subjectId: string; note: string }> = [];
        for (const item of members) {
            try {
                const normId = normalizeSubjectId(item.subjectId);
                normalizedMembers.push({ subjectType: item.subjectType, subjectId: normId, note: (item.note || '').trim() });
            } catch {
                skipped++;
            }
        }

        for (const item of normalizedMembers) {
            const memberId = randomUUID();
            const res = await this.db.insertInto('access_list_members').values({
                id: memberId,
                list_id: listId,
                subject_type: item.subjectType,
                subject_id: item.subjectId,
                note: item.note,
                created_at: now,
            }).onConflict((conflict) => conflict.doNothing()).execute();
            if (Number(res[0]?.numInsertedOrUpdatedRows ?? 0) > 0) {
                added++;
            } else {
                skipped++;
            }
        }

        if (added > 0) {
            await this.db.updateTable('access_lists').set({ updated_at: now }).where('id', '=', listId).execute();
            const state = await this.getAccessControlState();
            if (state.mode === 'blacklist' && state.activeBlacklistId === listId) {
                for (const item of normalizedMembers) {
                    await this.invalidateSummariesForSubject(item.subjectType, item.subjectId);
                }
            }
        }

        return { added, skipped };
    }

    async removeAccessListMember(listId: string, subjectType: AccessSubjectType, subjectId: string): Promise<void> {
        const normId = normalizeSubjectId(subjectId);
        await this.db.deleteFrom('access_list_members')
            .where('list_id', '=', listId)
            .where('subject_type', '=', subjectType)
            .where('subject_id', '=', normId)
            .execute();
        await this.db.updateTable('access_lists').set({ updated_at: Date.now() }).where('id', '=', listId).execute();

        const state = await this.getAccessControlState();
        if (state.mode === 'whitelist' && state.activeWhitelistId === listId) {
            await this.invalidateSummariesForSubject(subjectType, normId);
        }
    }

    async ensureActiveList(type: AccessListType, defaultName?: string): Promise<string> {
        const state = await this.getAccessControlState();
        const activeId = type === 'blacklist' ? state.activeBlacklistId : state.activeWhitelistId;
        if (activeId) {
            const existing = await this.getAccessList(activeId);
            if (existing && existing.type === type) return activeId;
        }
        const existingDefault = await this.db.selectFrom('access_lists')
            .selectAll()
            .where('type', '=', type)
            .where('is_default', '=', 1)
            .executeTakeFirst();
        if (existingDefault) {
            if (type === 'blacklist') {
                await this.setAccessControlState({ activeBlacklistId: existingDefault.id });
            } else {
                await this.setAccessControlState({ activeWhitelistId: existingDefault.id });
            }
            return existingDefault.id;
        }

        const name = defaultName || (type === 'blacklist' ? '默认黑名单' : '默认白名单');
        const existingByName = await this.db.selectFrom('access_lists')
            .selectAll()
            .where('type', '=', type)
            .where('name', '=', name)
            .executeTakeFirst();
        let listId = existingByName?.id;
        if (!listId) {
            const now = Date.now();
            listId = randomUUID();
            await this.db.insertInto('access_lists').values({
                id: listId,
                type,
                name,
                description: `系统默认${type === 'blacklist' ? '黑名单' : '白名单'}`,
                is_default: 1,
                created_at: now,
                updated_at: now,
            }).execute();
        }
        if (type === 'blacklist') {
            await this.setAccessControlState({ activeBlacklistId: listId });
        } else {
            await this.setAccessControlState({ activeWhitelistId: listId });
        }
        return listId;
    }

    async invalidateSummariesForSubject(subjectType: 'user' | 'group', subjectId: string): Promise<void> {
        if (subjectType === 'user') {
            await this.db.updateTable('conversation_summaries')
                .set({ content: '', covered_through_seq: 0, updated_at: Date.now() })
                .where('conversation_id', 'in', this.db.selectFrom('messages').select('conversation_id').where('sender_id', '=', subjectId))
                .execute();
        } else {
            await this.db.updateTable('conversation_summaries')
                .set({ content: '', covered_through_seq: 0, updated_at: Date.now() })
                .where('conversation_id', 'in', this.db.selectFrom('conversations').select('id').where('type', '=', 'group').where('target_id', '=', subjectId))
                .execute();
        }
    }

    async addBlacklist(type: 'user' | 'group', id: string): Promise<void> {
        const normId = normalizeSubjectId(id);
        const listId = await this.ensureActiveList('blacklist', '默认黑名单');
        await this.addAccessListMembers(listId, [{ subjectType: type, subjectId: normId }]);
        await this.db.insertInto('blacklist_entries').values({ subject_type: type, subject_id: normId, created_at: Date.now() })
            .onConflict((conflict) => conflict.doNothing()).execute();
    }

    async removeBlacklist(type: 'user' | 'group', id: string): Promise<void> {
        const normId = normalizeSubjectId(id);
        const state = await this.getAccessControlState();
        if (state.activeBlacklistId) {
            await this.removeAccessListMember(state.activeBlacklistId, type, normId);
        }
        await this.db.deleteFrom('blacklist_entries').where('subject_type', '=', type).where('subject_id', '=', normId).execute();
    }

    async listBlacklist(): Promise<{ type: 'user' | 'group'; id: string; createdAt: number }[]> {
        const state = await this.getAccessControlState();
        if (state.activeBlacklistId) {
            const members = await this.listAccessListMembers(state.activeBlacklistId);
            return members.map((m) => ({ type: m.subjectType, id: m.subjectId, createdAt: m.createdAt }));
        }
        return [];
    }

    async findMemories(qqs: string[], scopes: MemoryScope[]): Promise<UserMemory[]> {
        if (!qqs.length || !scopes.length) return [];
        const rows = await this.db.selectFrom('user_memories').selectAll().where('qq', 'in', qqs)
            .where('scope', 'in', scopes).where('valid', '=', 1).orderBy('updated_at', 'desc').limit(1000).execute();
        return rows.map(mapMemory);
    }

    async saveMemories(memories: Array<{
        qq: string; scope: MemoryScope; content: string; importance: number; confidence: number;
        sourceConversationId: string | null; sourceMessageId: string | null;
    }>): Promise<string[]> {
        const now = Date.now();
        const ids = memories.map(() => randomUUID());
        if (!memories.length) return [];
        for (const memory of memories) {
            await this.db.insertInto('user_profiles').values({ qq: memory.qq, display_name: '', address: '', address_manual: 0, created_at: now, updated_at: now })
                .onConflict((conflict) => conflict.doNothing()).execute();
        }
        await this.db.insertInto('user_memories').values(memories.map((memory, index) => ({
            id: ids[index], qq: memory.qq, scope: memory.scope, content: memory.content,
            importance: memory.importance, confidence: memory.confidence,
            source_conversation_id: memory.sourceConversationId, source_message_id: memory.sourceMessageId,
            valid: 1, superseded_by: null, use_count: 0, last_used_at: null,
            created_at: now, updated_at: now,
        }))).execute();
        return ids;
    }

    async supersedeMemory(oldId: string, newId: string): Promise<void> {
        await this.db.updateTable('user_memories').set({ valid: 0, superseded_by: newId, updated_at: Date.now() }).where('id', '=', oldId).execute();
    }

    async listMemories(search = '', qq = ''): Promise<UserMemory[]> {
        let query = this.db.selectFrom('user_memories').selectAll();
        if (qq) query = query.where('qq', '=', qq);
        if (search) query = query.where((eb) => eb.or([eb('qq', 'like', `%${search}%`), eb('content', 'like', `%${search}%`)]));
        const rows = await query.orderBy('updated_at', 'desc').limit(1000).execute();
        return rows.map(mapMemory);
    }

    async listMemoryUsers(search = ''): Promise<MemoryUserSummary[]> {
        let query = this.db.selectFrom('user_memories')
            .select((eb) => [
                'qq',
                eb.fn.count<number>('id').as('total'),
                eb.fn.sum<number>(eb.case().when('valid', '=', 1).then(1).else(0).end()).as('active'),
                eb.fn.sum<number>(eb.case().when('scope', '=', 'private').then(1).else(0).end()).as('private_count'),
                eb.fn.max('updated_at').as('last_updated_at'),
            ])
            .groupBy('qq');
        if (search) {
            const pattern = `%${search}%`;
            query = query.where((eb) => eb('qq', 'in', eb.selectFrom('user_memories as matched').select('matched.qq').where((inner) => inner.or([
                inner('matched.qq', 'like', pattern),
                inner('matched.content', 'like', pattern),
                inner('matched.qq', 'in', inner.selectFrom('user_profiles').select('user_profiles.qq').where((profiles) => profiles.or([
                    profiles('user_profiles.display_name', 'like', pattern),
                    profiles('user_profiles.address', 'like', pattern),
                ]))),
            ]))));
        }
        const rows = await query.orderBy('last_updated_at', 'desc').limit(500).execute();
        if (!rows.length) return [];
        const profiles = await this.getProfiles(rows.map((row) => row.qq));
        const names = new Map(profiles.map((profile) => [profile.qq, profile]));
        return rows.map((row) => {
            const total = Number(row.total);
            const privateCount = Number(row.private_count ?? 0);
            return {
                qq: row.qq,
                displayName: names.get(row.qq)?.displayName ?? '',
                address: names.get(row.qq)?.address ?? '',
                addressManual: names.get(row.qq)?.addressManual ?? false,
                total,
                active: Number(row.active ?? 0),
                privateCount,
                groupCount: total - privateCount,
                lastUpdatedAt: Number(row.last_updated_at ?? 0),
            };
        });
    }

    async getProfiles(qqs: string[]): Promise<UserProfile[]> {
        if (!qqs.length) return [];
        const rows = await this.db.selectFrom('user_profiles').selectAll().where('qq', 'in', qqs).execute();
        return rows.map((row) => ({
            qq: row.qq, displayName: row.display_name, address: row.address ?? '',
            addressManual: Boolean(row.address_manual ?? 0), updatedAt: Number(row.updated_at),
        }));
    }

    async setProfileAddress(qq: string, address: string, manual: boolean): Promise<void> {
        const now = Date.now();
        const value = address.trim().slice(0, 30);
        await this.db.insertInto('user_profiles').values({
            qq, display_name: '', address: value, address_manual: manual && value ? 1 : 0, created_at: now, updated_at: now,
        }).onConflict((conflict) => conflict.column('qq').doUpdateSet({
            address: value, address_manual: manual && value ? 1 : 0, updated_at: now,
        })).execute();
    }

    async updateMemory(id: string, patch: { content?: string; valid?: boolean; scope?: MemoryScope }): Promise<void> {
        const values: Partial<MemoryTable> = { updated_at: Date.now() };
        if (patch.content !== undefined) values.content = patch.content;
        if (patch.valid !== undefined) values.valid = patch.valid ? 1 : 0;
        if (patch.scope !== undefined) values.scope = patch.scope;
        await this.db.updateTable('user_memories').set(values).where('id', '=', id).execute();
    }

    async deleteMemory(id: string): Promise<void> {
        await this.db.deleteFrom('user_memories').where('id', '=', id).execute();
    }

    async markMemoriesUsed(ids: string[]): Promise<void> {
        if (!ids.length) return;
        await this.db.updateTable('user_memories').set((eb) => ({ use_count: eb('use_count', '+', 1), last_used_at: Date.now() })).where('id', 'in', ids).execute();
    }

    async findSticker(fingerprint: { napcatKey?: string | null; sha256?: string; phash?: string | null }): Promise<Sticker | null> {
        let query = this.db.selectFrom('stickers').selectAll();
        if (fingerprint.napcatKey) query = query.where('napcat_key', '=', fingerprint.napcatKey);
        else if (fingerprint.sha256) query = query.where('sha256', '=', fingerprint.sha256);
        else if (fingerprint.phash) query = query.where('phash', '=', fingerprint.phash);
        else return null;
        const row = await query.executeTakeFirst();
        return row ? mapSticker(row) : null;
    }

    async saveSticker(sticker: Omit<Sticker, 'id' | 'seenCount' | 'useCount' | 'firstSeenAt' | 'lastSeenAt' | 'lastUsedAt'> & { id?: string }): Promise<Sticker> {
        const now = Date.now();
        const id = sticker.id ?? randomUUID();
        await this.db.insertInto('stickers').values({
            id, napcat_key: sticker.napcatKey, sha256: sticker.sha256, phash: sticker.phash,
            path: sticker.path, mime: sticker.mime, summary: sticker.summary, tags_json: JSON.stringify(sticker.tags),
            safety_status: sticker.safetyStatus, seen_count: 1, use_count: 0, enabled: sticker.enabled ? 1 : 0,
            first_seen_at: now, last_seen_at: now, last_used_at: null,
        }).execute();
        return (await this.getSticker(id))!;
    }

    async getSticker(id: string): Promise<Sticker | null> {
        const row = await this.db.selectFrom('stickers').selectAll().where('id', '=', id).executeTakeFirst();
        return row ? mapSticker(row) : null;
    }

    async listStickers(search = ''): Promise<Sticker[]> {
        let query = this.db.selectFrom('stickers').selectAll();
        if (search) query = query.where((eb) => eb.or([eb('summary', 'like', `%${search}%`), eb('tags_json', 'like', `%${search}%`)]));
        const rows = await query.orderBy('last_seen_at', 'desc').limit(1000).execute();
        return rows.map(mapSticker);
    }

    async recordSighting(input: { stickerId: string | null; conversationId: string; messageId: string; fingerprint: string }): Promise<void> {
        await this.db.insertInto('sticker_sightings').values({
            id: randomUUID(), sticker_id: input.stickerId, conversation_id: input.conversationId,
            message_id: input.messageId, fingerprint: input.fingerprint, seen_at: Date.now(),
        }).execute();
        if (input.stickerId) {
            await this.db.updateTable('stickers').set((eb) => ({ seen_count: eb('seen_count', '+', 1), last_seen_at: Date.now() })).where('id', '=', input.stickerId).execute();
        }
    }

    async countSightings(fingerprint: string): Promise<number> {
        const row = await this.db.selectFrom('sticker_sightings').select((eb) => eb.fn.countAll().as('count')).where('fingerprint', '=', fingerprint).executeTakeFirst();
        return Number((row as { count?: string | number } | undefined)?.count ?? 0);
    }

    async updateSticker(id: string, patch: { enabled?: boolean; summary?: string }): Promise<void> {
        await this.db.updateTable('stickers').set({
            ...(patch.enabled === undefined ? {} : { enabled: patch.enabled ? 1 : 0 }),
            ...(patch.summary === undefined ? {} : { summary: patch.summary }),
        }).where('id', '=', id).execute();
    }

    async markStickerUsed(id: string): Promise<void> {
        await this.db.updateTable('stickers').set((eb) => ({ use_count: eb('use_count', '+', 1), last_used_at: Date.now() })).where('id', '=', id).execute();
    }

    async deleteSticker(id: string): Promise<void> {
        await this.db.deleteFrom('sticker_sightings').where('sticker_id', '=', id).execute();
        await this.db.deleteFrom('stickers').where('id', '=', id).execute();
    }

    async beginTool(key: string, conversationId: string, name: string, request: unknown): Promise<{ duplicate: boolean; result?: unknown }> {
        const existing = await this.db.selectFrom('tool_executions').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
        if (existing) return { duplicate: true, result: existing.result_json ? JSON.parse(existing.result_json) : null };
        await this.db.insertInto('tool_executions').values({
            idempotency_key: key, conversation_id: conversationId, tool_name: name,
            request_json: JSON.stringify(request), status: 'processing', result_json: null,
            created_at: Date.now(), updated_at: Date.now(),
        }).execute();
        return { duplicate: false };
    }

    async finishTool(key: string, status: 'completed' | 'failed', result: unknown): Promise<void> {
        await this.db.updateTable('tool_executions').set({ status, result_json: JSON.stringify(result ?? null), updated_at: Date.now() }).where('idempotency_key', '=', key).execute();
    }

    async isOwnMessage(conversationId: string, napcatMessageId: string): Promise<boolean> {
        const row = await this.db.selectFrom('messages').select('id').where('conversation_id', '=', conversationId)
            .where('napcat_message_id', '=', napcatMessageId).where('sender_kind', '=', 'self').executeTakeFirst();
        return Boolean(row);
    }

    async deleteConversation(id: string): Promise<void> {
        await this.db.deleteFrom('sticker_sightings').where('conversation_id', '=', id).execute();
        await this.db.deleteFrom('user_memories').where('source_conversation_id', '=', id).execute();
        await this.db.deleteFrom('messages').where('conversation_id', '=', id).execute();
        await this.db.deleteFrom('message_batches').where('conversation_id', '=', id).execute();
        await this.db.deleteFrom('conversation_summaries').where('conversation_id', '=', id).execute();
        await this.db.deleteFrom('tool_executions').where('conversation_id', '=', id).execute();
        await this.db.deleteFrom('conversations').where('id', '=', id).execute();
    }

    async deleteUserData(qq: string): Promise<void> {
        await this.db.deleteFrom('user_memories').where('qq', '=', qq).execute();
        await this.db.deleteFrom('user_profiles').where('qq', '=', qq).execute();
        const privateConversations = await this.db.selectFrom('conversations').select('id').where('type', '=', 'private').where('target_id', '=', qq).execute();
        for (const conversation of privateConversations) await this.deleteConversation(conversation.id);
        const affected = await this.db.selectFrom('messages').select(['id', 'conversation_id']).where('sender_id', '=', qq).execute();
        if (affected.length) {
            await this.db.deleteFrom('sticker_sightings').where('message_id', 'in', affected.map((message) => message.id)).execute();
            await this.db.deleteFrom('messages').where('sender_id', '=', qq).execute();
            const conversationIds = [...new Set(affected.map((message) => message.conversation_id))];
            await this.db.updateTable('conversation_summaries').set({ content: '', covered_through_seq: 0, updated_at: Date.now() })
                .where('conversation_id', 'in', conversationIds).execute();
        }
    }

    private async filterModelMessages(conversationId: string | undefined, rows: MessageRow[]): Promise<ChatMessage[]> {
        if (!rows.length) return [];
        const policy = await this.getAccessPolicySnapshot();
        if (conversationId) {
            const conversation = await this.getConversation(conversationId);
            if (conversation) {
                let targetId = conversation.targetId;
                try {
                    targetId = normalizeSubjectId(conversation.targetId);
                } catch {
                    // keep raw
                }
                const isConvAllowed = policy.mode === 'blacklist'
                    ? (conversation.type === 'group' ? !policy.groupBlacklist.includes(targetId) : !policy.userBlacklist.includes(targetId))
                    : (conversation.type === 'group' ? (policy.activeWhitelistId ? policy.groupWhitelist.includes(targetId) : false) : (policy.activeWhitelistId ? policy.userWhitelist.includes(targetId) : false));
                if (!isConvAllowed) return [];
            }
        }
        if (policy.mode === 'blacklist') {
            const users = new Set(policy.userBlacklist);
            return rows.filter((row) => {
                if (!row.sender_id) return true;
                try {
                    return !users.has(normalizeSubjectId(row.sender_id));
                } catch {
                    return !users.has(row.sender_id);
                }
            }).map(mapMessage);
        } else {
            return rows.map(mapMessage);
        }
    }

    async exportData(): Promise<Record<string, unknown>> {
        const tables = ['conversations', 'message_batches', 'messages', 'conversation_summaries', 'prompt_profiles', 'user_profiles', 'user_memories', 'blacklist_entries', 'access_lists', 'access_list_members', 'stickers', 'sticker_sightings', 'tool_executions'] as const;
        const output: Record<string, unknown> = {
            format: 'napcat-ai-chat-v1',
            exportedAt: Date.now(),
            accessControlState: await this.getAccessControlState(),
        };
        for (const table of tables) output[table] = await this.db.selectFrom(table).selectAll().execute();
        return output;
    }

    async importData(snapshot: Record<string, unknown>, applyAccessControl = false): Promise<void> {
        if (snapshot.format !== 'napcat-ai-chat-v1') throw new Error('不支持的数据导出格式');
        const tables = ['conversations', 'prompt_profiles', 'message_batches', 'messages', 'conversation_summaries', 'user_memories', 'blacklist_entries', 'access_lists', 'access_list_members', 'stickers', 'sticker_sightings', 'tool_executions'] as const;
        await this.db.transaction().execute(async (trx) => {
            for (const table of tables) {
                const rows = snapshot[table];
                if (!Array.isArray(rows) || !rows.length) continue;
                if (rows.length > 100000) throw new Error('单个数据表导入记录过多');
                for (let offset = 0; offset < rows.length; offset += 500) {
                    const chunk = rows.slice(offset, offset + 500);
                    await trx.insertInto(table).values(chunk as never).onConflict((conflict) => conflict.doNothing()).execute();
                }
            }
        });
        if (applyAccessControl && snapshot.accessControlState && typeof snapshot.accessControlState === 'object') {
            const acs = snapshot.accessControlState as Partial<AccessControlState>;
            await this.setAccessControlState(acs);
        }
    }

    async stats(): Promise<{ conversations: number; messages: number; memories: number; stickers: number; pendingBatches: number }> {
        const count = async (table: 'conversations' | 'messages' | 'user_memories' | 'stickers' | 'message_batches') => {
            const row = await this.db.selectFrom(table).select((eb) => eb.fn.countAll().as('count')).executeTakeFirst();
            return Number((row as { count?: string | number } | undefined)?.count ?? 0);
        };
        const [conversations, messages, memories, stickers] = await Promise.all([
            count('conversations'), count('messages'), count('user_memories'), count('stickers'),
        ]);
        const pending = await this.db.selectFrom('message_batches').select((eb) => eb.fn.countAll().as('count'))
            .where('status', 'in', ['pending', 'ready', 'processing']).executeTakeFirst();
        return { conversations, messages, memories, stickers, pendingBatches: Number((pending as { count?: string | number } | undefined)?.count ?? 0) };
    }
}

type ConversationRow = import('./schema').ConversationTable;
type BatchRow = import('./schema').BatchTable;
type MessageRow = import('./schema').MessageTable;
type AccessListRow = import('./schema').AccessListTable;
type AccessListMemberRow = import('./schema').AccessListMemberTable;

function mapConversation(row: ConversationRow): Conversation {
    return {
        id: row.id, type: row.type, targetId: row.target_id, title: row.title,
        nextSeq: Number(row.next_seq), override: JSON.parse(row.config_json || '{}'),
        promptProfileId: row.prompt_profile_id, providerProfileId: row.provider_profile_id,
        botRounds: Number(row.bot_rounds), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    };
}

function mapMessage(row: MessageRow): ChatMessage {
    return {
        id: row.id, conversationId: row.conversation_id, seq: Number(row.seq), batchId: row.batch_id,
        napcatMessageId: row.napcat_message_id, senderId: row.sender_id, senderName: row.sender_name,
        senderKind: row.sender_kind, role: row.role, content: JSON.parse(row.content_json),
        rawEvent: JSON.parse(row.raw_event_json || 'null'), occurredAt: Number(row.occurred_at), receivedAt: Number(row.received_at),
    };
}

function mapBatch(row: BatchRow): MessageBatch {
    return {
        id: row.id, conversationId: row.conversation_id, status: row.status,
        startSeq: Number(row.start_seq), endSeq: Number(row.end_seq), messageCount: Number(row.message_count),
        firstMessageAt: Number(row.first_message_at), lastMessageAt: Number(row.last_message_at),
        attempts: Number(row.attempts), error: row.error,
    };
}

function mapPrompt(row: import('./schema').PromptTable): PromptProfile {
    return { id: row.id, name: row.name, content: row.content, isDefault: Boolean(row.is_default), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function mapMemory(row: import('./schema').MemoryTable): UserMemory {
    return {
        id: row.id, qq: row.qq, scope: row.scope, content: row.content, importance: Number(row.importance),
        confidence: Number(row.confidence), sourceConversationId: row.source_conversation_id,
        sourceMessageId: row.source_message_id, valid: Boolean(row.valid), supersededBy: row.superseded_by,
        useCount: Number(row.use_count), lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    };
}

function mapSticker(row: import('./schema').StickerTable): Sticker {
    return {
        id: row.id, napcatKey: row.napcat_key, sha256: row.sha256, phash: row.phash, path: row.path,
        mime: row.mime, summary: row.summary, tags: JSON.parse(row.tags_json), safetyStatus: row.safety_status,
        seenCount: Number(row.seen_count), useCount: Number(row.use_count), enabled: Boolean(row.enabled),
        firstSeenAt: Number(row.first_seen_at), lastSeenAt: Number(row.last_seen_at),
        lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    };
}

function mapAccessList(row: AccessListRow): AccessList {
    return {
        id: row.id,
        type: row.type,
        name: row.name,
        description: row.description || '',
        isDefault: Boolean(row.is_default),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
    };
}

function mapAccessListMember(row: AccessListMemberRow): AccessListMember {
    return {
        id: row.id,
        listId: row.list_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        note: row.note || '',
        createdAt: Number(row.created_at),
    };
}
