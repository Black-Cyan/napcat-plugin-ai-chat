export type ConversationType = 'private' | 'group'
export type ProviderType = 'openai' | 'anthropic' | 'google'
export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql'
export type AccessMode = 'blacklist' | 'whitelist'
export type AccessListType = 'blacklist' | 'whitelist'
export type AccessSubjectType = 'user' | 'group'

export interface AccessList {
    id: string
    type: AccessListType
    name: string
    description: string
    isDefault: boolean
    createdAt: number
    updatedAt: number
}

export interface AccessListMember {
    id: string
    listId: string
    subjectType: AccessSubjectType
    subjectId: string
    note: string
    createdAt: number
}

export interface AccessControlState {
    mode: AccessMode
    activeBlacklistId: string | null
    activeWhitelistId: string | null
}

export interface AccessPolicySnapshot {
    mode: AccessMode
    activeBlacklistId: string | null
    activeWhitelistId: string | null
    activeBlacklistName: string | null
    activeWhitelistName: string | null
    userBlacklist: string[]
    groupBlacklist: string[]
    userWhitelist: string[]
    groupWhitelist: string[]
}

export interface NapCatContact {
    id: string
    name: string
    type: AccessSubjectType
    remark?: string
    memberCount?: number
}

export interface ProviderProfile {
    id: string; name: string; type: ProviderType; model: string; apiKey: string; baseUrl?: string
    contextWindow: number; maxOutputTokens: number; temperature: number
    vision: boolean; toolCalling: boolean; structuredOutput: boolean
}
export interface GoogleModelInfo {
    name: string; baseModelId: string; displayName: string; description: string
    supportedGenerationMethods: string[]; inputTokenLimit: number; outputTokenLimit: number; thinking: boolean
}
export interface GoogleModelDiscovery {
    models: GoogleModelInfo[]; fetchedAt: number; cached: boolean; stale: boolean; error?: string
}

export interface DatabaseConfig {
    driver: DatabaseDriver; sqliteFile: string; connectionString: string; poolSize: number; tls: boolean
}
export interface BehaviorConfig {
    engagement: number; quietMs: number; maxWaitMs: number; maxBatchMessages: number
    replyCooldownMs: number; sameSourceBurstThreshold: number; botRoundLimit: number
    maxConcurrentTasks: number; recentMessageCount: number; maxInputTokens: number; inputBudgetRatio: number
    compressionTriggerRatio: number; maxContextRetries: number
}
export interface StickerConfig { enabled: boolean; autoCollect: boolean; autoSend: boolean; maxImageBytes: number; cacheLimitMb: number }
export interface SessionOverride {
    enabled?: boolean; promptProfileId?: string | null; providerProfileId?: string | null
    behavior?: Partial<BehaviorConfig>; vision?: boolean; stickers?: Partial<StickerConfig>
}
export interface PluginConfig {
    enabled: boolean; debug: boolean; commandPrefix: string; owners: string[]
    defaultProviderId: string | null
    taskProviders: { summary: string | null; memory: string | null; vision: string | null }
    providers: ProviderProfile[]; database: DatabaseConfig; behavior: BehaviorConfig
    privateDefaults: SessionOverride; groupDefaults: SessionOverride; stickers: StickerConfig
    stats: { processed: number; replies: number; startedAt: number }
}
export interface PluginStatus {
    ready: boolean; database: DatabaseDriver; activeBatches: number; queuedBatches: number
    uptime: number; stats: PluginConfig['stats']; initializationError: string
    resources: { conversations: number; messages: number; memories: number; stickers: number; pendingBatches: number } | null
}
export interface Conversation {
    id: string; type: ConversationType; targetId: string; title: string; nextSeq: number
    override: SessionOverride; promptProfileId: string | null; providerProfileId: string | null
    botRounds: number; createdAt: number; updatedAt: number
}
export interface PromptProfile { id: string; name: string; content: string; isDefault: boolean; createdAt: number; updatedAt: number }
export interface UserMemory {
    id: string; qq: string; scope: 'private' | 'group'; content: string; importance: number; confidence: number
    valid: boolean; useCount: number; updatedAt: number
}
export interface Sticker {
    id: string; path: string; mime: string; summary: string; tags: string[]
    safetyStatus: 'safe' | 'rejected' | 'unknown'; seenCount: number; useCount: number; enabled: boolean; lastSeenAt: number
}
export interface ChatMessage {
    id: string; seq: number; senderId: string | null; senderName: string; senderKind: 'human' | 'bot' | 'self'
    role: 'user' | 'assistant'; content: Array<{ type: string; data: Record<string, unknown> }>; occurredAt: number
}
export interface LogEntry {
    id: number
    time: number
    level: 'info' | 'warn' | 'error' | 'debug'
    category?: string
    message: string
    details?: unknown
}
export interface ApiResponse<T = unknown> { code: 0 | -1; data?: T; message?: string }
