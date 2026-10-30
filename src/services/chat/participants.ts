import type { ChatMessage } from '../../types';

export class ParticipantAliases {
    private readonly byId = new Map<string, string>();
    private readonly byAlias = new Map<string, string>();
    private readonly names = new Map<string, string>();

    constructor(messages: ChatMessage[]) {
        for (const message of messages) {
            if (!message.senderId || message.senderKind === 'self' || this.byId.has(message.senderId)) continue;
            const alias = `p${this.byId.size + 1}`;
            this.byId.set(message.senderId, alias);
            this.byAlias.set(alias, message.senderId);
            this.names.set(alias, message.senderName);
        }
    }

    alias(id: string | null): string | null {
        return id ? this.byId.get(id) ?? null : null;
    }

    id(alias: string | null | undefined): string | null {
        return alias ? this.byAlias.get(alias) ?? null : null;
    }

    name(alias: string): string {
        return this.names.get(alias) ?? '参与者';
    }

    entries(): Array<{ id: string; alias: string; name: string }> {
        return [...this.byId].map(([id, alias]) => ({ id, alias, name: this.names.get(alias) ?? '参与者' }));
    }

    ids(): string[] {
        return [...this.byId.keys()];
    }

    descriptor(id: string | null, fallback: string): { alias: string; name: string } | null {
        const alias = this.alias(id);
        return alias ? { alias, name: this.name(alias) } : { alias: 'unknown', name: fallback };
    }
}
