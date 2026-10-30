import { pluginState } from '../../core/state';
import type { Conversation, UserMemory } from '../../types';
import { IMMUTABLE_SECURITY_PROMPT } from './policy';

export class ResponseGuard {
    sanitize(text: string, conversation: Conversation, memories: UserMemory[]): string {
        if (!text.trim() || text.trim() === 'NO_REPLY') return text;
        const needles: string[] = [
            conversation.targetId,
            pluginState.selfId,
            pluginState.ctx.dataPath,
            pluginState.ctx.configPath,
            pluginState.config.database.connectionString,
            ...pluginState.config.owners,
            ...pluginState.config.providers.flatMap((provider) => [provider.apiKey, provider.baseUrl ?? '']),
            ...memories.map((memory) => memory.qq),
            ...memories.flatMap((memory) => [memory.content, memory.qq]),
            ...IMMUTABLE_SECURITY_PROMPT.split('\n').map((line) => line.slice(2)).filter((line) => line.length >= 24),
        ];
        if (needles.some((needle) => isSensitiveMatch(text, needle))) return refusal();
        if (/(?:postgres(?:ql)?|mysql):\/\/|api[_ -]?key\s*[:=]|(?:^|[\s"'])\/(?:home|root|var|etc|usr)\//i.test(text)) return refusal();
        return text;
    }
}

function isSensitiveMatch(text: string, needle: string): boolean {
    const normalized = needle.trim();
    if (normalized.length < 6) return false;
    return text.includes(normalized);
}

function refusal(): string {
    return '抱歉，我不能透露这类隐私信息。';
}
