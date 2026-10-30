import { Store } from '../../database/store';
import type {
    AccessControlState,
    AccessMode,
    AccessPolicySnapshot,
    AccessSubjectType,
} from '../../types';
import { normalizeSubjectId } from '../../types';

export class AccessControlService {
    private snapshot: AccessPolicySnapshot | null = null;

    constructor(private readonly store: Store) {}

    async init(): Promise<void> {
        this.snapshot = await this.store.getAccessPolicySnapshot();
    }

    async refresh(): Promise<AccessPolicySnapshot> {
        try {
            const next = await this.store.getAccessPolicySnapshot();
            this.snapshot = next;
            return next;
        } catch (error) {
            if (!this.snapshot) throw error;
            return this.snapshot;
        }
    }

    getSnapshot(): AccessPolicySnapshot | null {
        return this.snapshot;
    }

    isAllowed(userId: string, groupId?: string): boolean {
        if (!this.snapshot) return false; // Fail closed if uninitialized

        let normUser = '';
        if (userId) {
            try {
                normUser = normalizeSubjectId(userId);
            } catch {
                normUser = userId.trim();
            }
        }

        let normGroup: string | undefined;
        if (groupId) {
            try {
                normGroup = normalizeSubjectId(groupId);
            } catch {
                normGroup = groupId.trim();
            }
        }

        if (this.snapshot.mode === 'blacklist') {
            if (!this.snapshot.activeBlacklistId) return true;
            if (normUser && this.snapshot.userBlacklist.includes(normUser)) return false;
            if (normGroup && this.snapshot.groupBlacklist.includes(normGroup)) return false;
            return true;
        } else {
            if (!this.snapshot.activeWhitelistId) return false;
            if (normGroup) {
                return this.snapshot.groupWhitelist.includes(normGroup);
            }
            return normUser ? this.snapshot.userWhitelist.includes(normUser) : false;
        }
    }

    async setMode(mode: AccessMode, activeBlacklistId?: string | null, activeWhitelistId?: string | null): Promise<AccessControlState> {
        const result = await this.store.setAccessControlState({
            mode,
            ...(activeBlacklistId !== undefined ? { activeBlacklistId } : {}),
            ...(activeWhitelistId !== undefined ? { activeWhitelistId } : {}),
        });
        await this.refresh();
        return result;
    }
}
