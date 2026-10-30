import type { NapCatPluginContext } from './plugin-types';
import type { Conversation, MessageSegment, NapCatContact } from '../types';
import { normalizeSubjectId } from '../types';

export async function callAction<T>(ctx: NapCatPluginContext, name: string, params: Record<string, unknown>): Promise<T> {
    return ctx.actions.call(name as never, params as never, ctx.adapterName, ctx.pluginManager.config) as Promise<T>;
}

export async function sendMessage(
    ctx: NapCatPluginContext,
    conversation: Pick<Conversation, 'type' | 'targetId'>,
    message: MessageSegment[],
): Promise<{ messageId: string }> {
    const result = await callAction<{ message_id?: string | number }>(ctx, 'send_msg', {
        message_type: conversation.type,
        ...(conversation.type === 'group' ? { group_id: conversation.targetId } : { user_id: conversation.targetId }),
        message,
    });
    if (result?.message_id == null) throw new Error('NapCat 未返回消息 ID');
    return { messageId: String(result.message_id) };
}

export async function getMessage(ctx: NapCatPluginContext, messageId: string): Promise<{
    message?: MessageSegment[] | string;
    raw_message?: string;
    user_id?: string | number;
    sender?: { user_id?: string | number; nickname?: string };
}> {
    return callAction(ctx, 'get_msg', { message_id: messageId });
}

export async function deleteMessage(ctx: NapCatPluginContext, messageId: string): Promise<void> {
    await callAction(ctx, 'delete_msg', { message_id: messageId });
}

export async function poke(ctx: NapCatPluginContext, conversation: Pick<Conversation, 'type' | 'targetId'>, userId: string): Promise<void> {
    if (conversation.type === 'group') {
        await callAction(ctx, 'group_poke', { group_id: conversation.targetId, user_id: userId });
    } else {
        await callAction(ctx, 'friend_poke', { user_id: userId });
    }
}

export async function setMessageEmojiLike(ctx: NapCatPluginContext, messageId: string, emojiId: string): Promise<void> {
    await callAction(ctx, 'set_msg_emoji_like', { message_id: messageId, emoji_id: emojiId });
}

export async function addCustomFace(ctx: NapCatPluginContext, file: string, metadata?: {
    emojiId?: string; packageId?: string; fileName?: string; fileSize?: number; md5?: string; isMarketFace?: boolean;
}): Promise<void> {
    await callAction(ctx, 'add_custom_face', {
        file,
        ...(metadata?.emojiId ? { emoji_id: metadata.emojiId } : {}),
        ...(metadata?.packageId ? { package_id: metadata.packageId } : {}),
        ...(metadata?.fileName ? { file_name: metadata.fileName } : {}),
        ...(metadata?.fileSize ? { file_size: metadata.fileSize } : {}),
        ...(metadata?.md5 ? { md5: metadata.md5 } : {}),
        ...(metadata?.isMarketFace !== undefined ? { is_mark_face: metadata.isMarketFace } : {}),
    });
}

export interface RawNapCatGroup {
    group_id: number | string;
    group_name: string;
    group_remark?: string;
    member_count?: number;
    max_member_count?: number;
}

export interface RawNapCatFriend {
    user_id: number | string;
    nickname: string;
    remark?: string;
    qid?: string;
}

export async function getGroupList(ctx: NapCatPluginContext, noCache = false): Promise<NapCatContact[]> {
    const raw = await callAction<RawNapCatGroup[]>(ctx, 'get_group_list', { no_cache: noCache });
    if (!Array.isArray(raw)) return [];
    return raw.map((g) => ({
        id: normalizeSubjectId(g.group_id),
        name: g.group_name || String(g.group_id),
        type: 'group' as const,
        remark: g.group_remark || undefined,
        memberCount: g.member_count,
    }));
}

export async function getFriendList(ctx: NapCatPluginContext, noCache = false): Promise<NapCatContact[]> {
    const raw = await callAction<RawNapCatFriend[]>(ctx, 'get_friend_list', { no_cache: noCache });
    if (!Array.isArray(raw)) return [];
    return raw.map((f) => ({
        id: normalizeSubjectId(f.user_id),
        name: f.nickname || String(f.user_id),
        type: 'user' as const,
        remark: f.remark || undefined,
    }));
}

export interface NapCatImageResult {
    file?: string;
    url?: string;
    base64?: string;
    src?: string;
}

export async function getImage(ctx: NapCatPluginContext, file: string): Promise<NapCatImageResult> {
    return callAction<NapCatImageResult>(ctx, 'get_image', { file });
}
