import type { NapCatPluginContext } from '../napcat/plugin-types';
import { pluginState } from './state';
import { createDatabase, type Database } from '../database/database';
import { Store } from '../database/store';
import { ProviderRegistry } from '../providers/registry';
import { AITasks } from '../services/ai/tasks';
import { MemoryService } from '../services/memory/memory-service';
import { SummaryService } from '../services/context/summary-service';
import { ContextComposer } from '../services/context/context-composer';
import { StickerService } from '../services/stickers/sticker-service';
import { ToolBroker } from '../services/chat/tool-broker';
import { ParticipationService } from '../services/chat/participation';
import { ChatOrchestrator } from '../services/chat/chat-orchestrator';
import { BatchScheduler } from '../services/chat/batch-scheduler';
import { AccessControlService } from '../services/security/access-control-service';
import { OwnerCommandService } from '../services/security/owner-commands';
import { normalizeMessage } from '../napcat/message-segments';
import type { Conversation, RuntimeStatus } from '../types';
import { safeDiagnostic } from './diagnostics';
import { runtimeLogs } from './log-buffer';

export class PluginRuntime {
    database: Database | null = null;
    store: Store | null = null;
    scheduler: BatchScheduler | null = null;
    accessControl: AccessControlService | null = null;
    stickers: StickerService | null = null;
    owners: OwnerCommandService | null = null;
    ready = false;
    initializationError = '';

    async init(ctx: NapCatPluginContext): Promise<void> {
        pluginState.init(ctx);
        try {
            this.database = await createDatabase(pluginState.config.database, ctx.dataPath);
            this.store = new Store(this.database);
            await this.store.seed();
            await pluginState.fetchSelfId();
            const providers = new ProviderRegistry(() => pluginState.config.providers);
            const tasks = new AITasks(providers);
            const memories = new MemoryService(this.store, tasks);
            const summaries = new SummaryService(this.store, tasks);
            const context = new ContextComposer(this.store, memories, summaries);
            this.stickers = new StickerService(this.store, tasks);
            const tools = new ToolBroker(this.store, this.stickers);
            const participation = new ParticipationService(this.store);
            this.accessControl = new AccessControlService(this.store);
            await this.accessControl.init();
            const orchestrator = new ChatOrchestrator(
                this.store, providers, context, memories, this.stickers, tools, participation, this.accessControl,
            );
            this.scheduler = new BatchScheduler(this.store, orchestrator);
            this.owners = new OwnerCommandService(this.store, this.accessControl, this.stickers);
            this.ready = true;
            this.initializationError = '';
            await this.scheduler.recover();
        } catch (error) {
            this.ready = false;
            this.initializationError = safeDiagnostic(error);
            runtimeLogs.add('error', this.initializationError);
            pluginState.logger.error('插件运行环境初始化失败', this.initializationError);
        }
    }

    async onMessage(event: unknown): Promise<void> {
        if (!this.ready || !this.store || !this.scheduler || !this.accessControl || !this.owners) return;
        const incoming = normalizeMessage(event);
        if (!incoming || incoming.senderKind === 'self') return;
        const groupId = incoming.type === 'group' ? incoming.targetId : undefined;

        if (pluginState.config.debug) {
            runtimeLogs.add('debug', `收到消息: [${incoming.type}] ${incoming.senderName}(${incoming.userId})`, 'chat', {
                type: incoming.type,
                targetId: incoming.targetId,
                userId: incoming.userId,
                senderName: incoming.senderName,
                senderKind: incoming.senderKind,
                messageId: incoming.messageId,
                segments: incoming.segments,
            });
        }

        let conversation: Conversation | null = null;
        if (incoming.type === 'private' && pluginState.config.owners.includes(incoming.userId)) {
            conversation = await this.store.ensureConversation('private', incoming.targetId, incoming.title);
            if (await this.owners.handle(incoming, conversation)) return;
        }
        if (!this.accessControl.isAllowed(incoming.userId, groupId)) return;
        conversation ??= await this.store.ensureConversation(incoming.type, incoming.targetId, incoming.title);
        const appended = await this.store.appendMessage({
            conversationId: conversation.id,
            napcatMessageId: incoming.messageId,
            senderId: incoming.userId,
            senderName: incoming.senderName,
            senderKind: incoming.senderKind,
            role: 'user',
            content: incoming.segments,
            rawEvent: incoming.rawEvent,
            occurredAt: incoming.occurredAt,
            batch: true,
        });
        if (!appended.duplicate && appended.batch) await this.scheduler.schedule(appended.batch);
    }

    status(): RuntimeStatus {
        const queue = this.scheduler?.status() ?? { active: 0, queued: 0 };
        return {
            ready: this.ready,
            database: pluginState.config.database.driver,
            activeBatches: queue.active,
            queuedBatches: queue.queued,
            uptime: pluginState.getUptime(),
            stats: pluginState.config.stats,
        };
    }

    async cleanup(): Promise<void> {
        this.ready = false;
        if (this.scheduler) await this.scheduler.close();
        if (this.database) await this.database.close();
        this.scheduler = null;
        this.database = null;
        this.store = null;
        this.accessControl = null;
        this.stickers = null;
        this.owners = null;
        pluginState.cleanup();
    }
}

export const runtime = new PluginRuntime();
