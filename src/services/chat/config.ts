import type { BehaviorConfig, Conversation, SessionOverride, StickerConfig } from '../../types';
import { pluginState } from '../../core/state';

export function sessionOverride(conversation: Conversation): SessionOverride {
    const defaults = conversation.type === 'private' ? pluginState.config.privateDefaults : pluginState.config.groupDefaults;
    return {
        ...defaults,
        ...conversation.override,
        behavior: { ...defaults.behavior, ...conversation.override.behavior },
        stickers: { ...defaults.stickers, ...conversation.override.stickers },
    };
}

export function effectiveBehavior(conversation: Conversation): BehaviorConfig {
    return { ...pluginState.config.behavior, ...sessionOverride(conversation).behavior };
}

export function effectiveStickers(conversation: Conversation): StickerConfig {
    return { ...pluginState.config.stickers, ...sessionOverride(conversation).stickers };
}

export function effectiveVision(conversation: Conversation): boolean {
    return sessionOverride(conversation).vision ?? true;
}

export function effectiveProviderId(conversation: Conversation): string | null {
    return conversation.providerProfileId
        ?? sessionOverride(conversation).providerProfileId
        ?? pluginState.config.defaultProviderId;
}

export function effectivePromptId(conversation: Conversation): string | null {
    return conversation.promptProfileId ?? sessionOverride(conversation).promptProfileId ?? null;
}

export function conversationEnabled(conversation: Conversation): boolean {
    return pluginState.config.enabled && (sessionOverride(conversation).enabled ?? true);
}
