export type ConversationType = 'private' | 'group';
export type ProviderType = 'openai' | 'anthropic' | 'google';
export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql';
export type MemoryScope = 'private' | 'group';
export type AccessMode = 'blacklist' | 'whitelist';
export type AccessListType = 'blacklist' | 'whitelist';
export type AccessSubjectType = 'user' | 'group';

export interface AccessList {
    id: string;
    type: AccessListType;
    name: string;
    description: string;
    isDefault: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface AccessListMember {
    id: string;
    listId: string;
    subjectType: AccessSubjectType;
    subjectId: string;
    note: string;
    createdAt: number;
}

export interface AccessControlState {
    mode: AccessMode;
    activeBlacklistId: string | null;
    activeWhitelistId: string | null;
}

export interface AccessPolicySnapshot {
    mode: AccessMode;
    activeBlacklistId: string | null;
    activeWhitelistId: string | null;
    activeBlacklistName: string | null;
    activeWhitelistName: string | null;
    userBlacklist: string[];
    groupBlacklist: string[];
    userWhitelist: string[];
    groupWhitelist: string[];
}

export interface NapCatContact {
    id: string;
    name: string;
    type: AccessSubjectType;
    remark?: string;
    memberCount?: number;
}

export function normalizeSubjectId(id: string | number): string {
    const raw = String(id ?? '').trim();
    const stripped = raw.replace(/^0+(\d)/, '$1');
    if (!/^\d{1,64}$/.test(stripped)) {
        throw new Error('QQ 号或群号必须为 1-64 位有效数字');
    }
    return stripped;
}

export interface ProviderProfile {
    id: string;
    name: string;
    type: ProviderType;
    model: string;
    apiKey: string;
    baseUrl?: string;
    contextWindow: number;
    maxOutputTokens: number;
    temperature: number;
    vision: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
}

export interface GoogleModelInfo {
    name: string;
    baseModelId: string;
    displayName: string;
    description: string;
    supportedGenerationMethods: string[];
    inputTokenLimit: number;
    outputTokenLimit: number;
    thinking: boolean;
}

export interface GoogleModelDiscovery {
    models: GoogleModelInfo[];
    fetchedAt: number;
    cached: boolean;
    stale: boolean;
    error?: string;
}

export interface DatabaseConfig {
    driver: DatabaseDriver;
    sqliteFile: string;
    connectionString: string;
    poolSize: number;
    tls: boolean;
}

export interface BehaviorConfig {
    engagement: number;
    quietMs: number;
    maxWaitMs: number;
    maxBatchMessages: number;
    replyCooldownMs: number;
    sameSourceBurstThreshold: number;
    botRoundLimit: number;
    maxConcurrentTasks: number;
    recentMessageCount: number;
    maxInputTokens: number;
    inputBudgetRatio: number;
    compressionTriggerRatio: number;
    maxContextRetries: number;
}

export interface StickerConfig {
    enabled: boolean;
    autoCollect: boolean;
    autoSend: boolean;
    maxImageBytes: number;
    cacheLimitMb: number;
}

export interface SessionOverride {
    enabled?: boolean;
    promptProfileId?: string | null;
    providerProfileId?: string | null;
    behavior?: Partial<BehaviorConfig>;
    vision?: boolean;
    stickers?: Partial<StickerConfig>;
}

export interface TaskProviderConfig {
    summary: string | null;
    memory: string | null;
    vision: string | null;
}

export interface PluginConfig {
    enabled: boolean;
    debug: boolean;
    commandPrefix: '#' | string;
    owners: string[];
    defaultProviderId: string | null;
    taskProviders: TaskProviderConfig;
    providers: ProviderProfile[];
    database: DatabaseConfig;
    behavior: BehaviorConfig;
    privateDefaults: SessionOverride;
    groupDefaults: SessionOverride;
    stickers: StickerConfig;
    stats: {
        processed: number;
        replies: number;
        startedAt: number;
    };
}

export interface Conversation {
    id: string;
    type: ConversationType;
    targetId: string;
    title: string;
    nextSeq: number;
    override: SessionOverride;
    promptProfileId: string | null;
    providerProfileId: string | null;
    botRounds: number;
    createdAt: number;
    updatedAt: number;
}

export type SenderKind = 'human' | 'bot' | 'self';

export interface ChatMessage {
    id: string;
    conversationId: string;
    seq: number;
    batchId: string | null;
    napcatMessageId: string | null;
    senderId: string | null;
    senderName: string;
    senderKind: SenderKind;
    role: 'user' | 'assistant';
    content: MessageSegment[];
    rawEvent: unknown;
    occurredAt: number;
    receivedAt: number;
}

export interface MessageSegment {
    type: string;
    data: Record<string, unknown>;
}

export interface MessageBatch {
    id: string;
    conversationId: string;
    status: 'pending' | 'ready' | 'processing' | 'completed' | 'skipped' | 'failed';
    startSeq: number;
    endSeq: number;
    messageCount: number;
    firstMessageAt: number;
    lastMessageAt: number;
    attempts: number;
    error: string | null;
}

export interface PromptProfile {
    id: string;
    name: string;
    content: string;
    isDefault: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface UserMemory {
    id: string;
    qq: string;
    scope: MemoryScope;
    content: string;
    importance: number;
    confidence: number;
    sourceConversationId: string | null;
    sourceMessageId: string | null;
    valid: boolean;
    supersededBy: string | null;
    useCount: number;
    lastUsedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface Sticker {
    id: string;
    napcatKey: string | null;
    sha256: string;
    phash: string | null;
    path: string;
    mime: string;
    summary: string;
    tags: string[];
    safetyStatus: 'safe' | 'rejected' | 'unknown';
    seenCount: number;
    useCount: number;
    enabled: boolean;
    firstSeenAt: number;
    lastSeenAt: number;
    lastUsedAt: number | null;
}

export interface ApiResponse<T = unknown> {
    code: 0 | -1;
    data?: T;
    message?: string;
}

export interface RuntimeStatus {
    ready: boolean;
    database: DatabaseDriver;
    activeBatches: number;
    queuedBatches: number;
    uptime: number;
    stats: PluginConfig['stats'];
}
