import type { MessageBatch } from '../../types';
import { Store } from '../../database/store';
import { pluginState } from '../../core/state';
import { effectiveBehavior } from './config';
import { ChatOrchestrator } from './chat-orchestrator';

export class BatchScheduler {
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly queued = new Set<string>();
    private readonly runningConversations = new Set<string>();
    private readonly active = new Set<Promise<void>>();
    private readonly conversations = new Map<string, string>();
    private running = 0;
    private closed = false;

    constructor(private readonly store: Store, private readonly orchestrator: ChatOrchestrator) {}

    async recover(): Promise<void> {
        await this.store.recoverProcessingBatches();
        const batches = await this.store.listOpenBatches();
        for (const batch of batches) await this.schedule(batch);
    }

    async schedule(batch: MessageBatch): Promise<void> {
        if (this.closed || batch.attempts >= 3) return;
        const conversation = await this.store.getConversation(batch.conversationId);
        if (!conversation) return;
        this.conversations.set(batch.id, batch.conversationId);
        if (batch.status === 'ready') {
            this.enqueue(batch.id);
            return;
        }
        if (batch.status === 'failed') {
            this.resetTimer(batch.id, Math.max(1000, batch.attempts * 5000), () => this.enqueue(batch.id));
            return;
        }
        const behavior = effectiveBehavior(conversation);
        if (batch.messageCount >= behavior.maxBatchMessages) {
            await this.store.closeBatch(batch.id);
            this.enqueue(batch.id);
            return;
        }
        const sinceLast = Date.now() - batch.lastMessageAt;
        const remainingMax = Math.max(0, behavior.maxWaitMs - (Date.now() - batch.firstMessageAt));
        const delay = Math.max(0, Math.min(behavior.quietMs - sinceLast, remainingMax));
        this.resetTimer(batch.id, delay, async () => {
            await this.store.closeBatch(batch.id);
            this.enqueue(batch.id);
        });
    }

    enqueue(batchId: string): void {
        if (this.closed) return;
        this.queued.add(batchId);
        this.pump();
    }

    status(): { active: number; queued: number } {
        return { active: this.running, queued: this.queued.size };
    }

    async close(): Promise<void> {
        this.closed = true;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.queued.clear();
        await Promise.allSettled([...this.active]);
        await this.orchestrator.drain();
    }

    private resetTimer(batchId: string, delay: number, callback: () => void | Promise<void>): void {
        const previous = this.timers.get(batchId);
        if (previous) clearTimeout(previous);
        this.timers.set(batchId, setTimeout(() => {
            this.timers.delete(batchId);
            void Promise.resolve(callback()).catch(() => undefined);
        }, Math.max(0, delay)));
    }

    private pump(): void {
        const maximum = pluginState.config.behavior.maxConcurrentTasks;
        for (const batchId of [...this.queued]) {
            if (this.running >= maximum) break;
            const conversationId = this.conversations.get(batchId);
            if (!conversationId || this.runningConversations.has(conversationId)) continue;
            this.queued.delete(batchId);
            this.running += 1;
            this.runningConversations.add(conversationId);
            let task: Promise<void>;
            task = this.orchestrator.process(batchId).finally(() => {
                this.running -= 1;
                this.runningConversations.delete(conversationId);
                this.active.delete(task);
                this.pump();
            });
            this.active.add(task);
        }
    }
}
