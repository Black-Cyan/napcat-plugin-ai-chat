export interface ConversationTable {
    id: string;
    type: 'private' | 'group';
    target_id: string;
    title: string;
    next_seq: number;
    config_json: string;
    prompt_profile_id: string | null;
    provider_profile_id: string | null;
    bot_rounds: number;
    created_at: number;
    updated_at: number;
}

export interface MessageTable {
    id: string;
    conversation_id: string;
    seq: number;
    batch_id: string | null;
    napcat_message_id: string | null;
    sender_id: string | null;
    sender_name: string;
    sender_kind: 'human' | 'bot' | 'self';
    role: 'user' | 'assistant';
    content_json: string;
    raw_event_json: string;
    occurred_at: number;
    received_at: number;
}

export interface BatchTable {
    id: string;
    conversation_id: string;
    status: 'pending' | 'ready' | 'processing' | 'completed' | 'skipped' | 'failed';
    start_seq: number;
    end_seq: number;
    message_count: number;
    first_message_at: number;
    last_message_at: number;
    attempts: number;
    error: string | null;
}

export interface SummaryTable {
    conversation_id: string;
    content: string;
    covered_through_seq: number;
    updated_at: number;
}

export interface PromptTable {
    id: string;
    name: string;
    content: string;
    is_default: number;
    created_at: number;
    updated_at: number;
}

export interface UserProfileTable {
    qq: string;
    display_name: string;
    created_at: number;
    updated_at: number;
}

export interface MemoryTable {
    id: string;
    qq: string;
    scope: 'private' | 'group';
    content: string;
    importance: number;
    confidence: number;
    source_conversation_id: string | null;
    source_message_id: string | null;
    valid: number;
    superseded_by: string | null;
    use_count: number;
    last_used_at: number | null;
    created_at: number;
    updated_at: number;
}

export interface BlacklistTable {
    subject_type: 'user' | 'group';
    subject_id: string;
    created_at: number;
}

export interface AccessListTable {
    id: string;
    type: 'blacklist' | 'whitelist';
    name: string;
    description: string;
    is_default: number;
    created_at: number;
    updated_at: number;
}

export interface AccessListMemberTable {
    id: string;
    list_id: string;
    subject_type: 'user' | 'group';
    subject_id: string;
    note: string;
    created_at: number;
}

export interface StickerTable {
    id: string;
    napcat_key: string | null;
    sha256: string;
    phash: string | null;
    path: string;
    mime: string;
    summary: string;
    tags_json: string;
    safety_status: 'safe' | 'rejected' | 'unknown';
    seen_count: number;
    use_count: number;
    enabled: number;
    first_seen_at: number;
    last_seen_at: number;
    last_used_at: number | null;
}

export interface StickerSightingTable {
    id: string;
    sticker_id: string | null;
    conversation_id: string;
    message_id: string;
    fingerprint: string;
    seen_at: number;
}

export interface ToolExecutionTable {
    idempotency_key: string;
    conversation_id: string;
    tool_name: string;
    request_json: string;
    status: 'processing' | 'completed' | 'failed';
    result_json: string | null;
    created_at: number;
    updated_at: number;
}

export interface MetadataTable {
    key: string;
    value: string;
}

export interface DatabaseSchema {
    conversations: ConversationTable;
    messages: MessageTable;
    message_batches: BatchTable;
    conversation_summaries: SummaryTable;
    prompt_profiles: PromptTable;
    user_profiles: UserProfileTable;
    user_memories: MemoryTable;
    blacklist_entries: BlacklistTable;
    access_lists: AccessListTable;
    access_list_members: AccessListMemberTable;
    stickers: StickerTable;
    sticker_sightings: StickerSightingTable;
    tool_executions: ToolExecutionTable;
    app_metadata: MetadataTable;
}
