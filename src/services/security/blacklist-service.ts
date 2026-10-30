import { Store } from '../../database/store';

export class BlacklistService {
    private readonly entries = new Set<string>();

    constructor(private readonly store: Store) {}

    async init(): Promise<void> {
        this.entries.clear();
        for (const entry of await this.store.listBlacklist()) this.entries.add(`${entry.type}:${entry.id}`);
    }

    allowed(userId: string, groupId?: string): boolean {
        if (this.entries.has(`user:${userId}`)) return false;
        return !groupId || !this.entries.has(`group:${groupId}`);
    }

    async add(type: 'user' | 'group', id: string): Promise<void> {
        await this.store.addBlacklist(type, id);
        this.entries.add(`${type}:${id}`);
    }

    async remove(type: 'user' | 'group', id: string): Promise<void> {
        await this.store.removeBlacklist(type, id);
        this.entries.delete(`${type}:${id}`);
    }
}
