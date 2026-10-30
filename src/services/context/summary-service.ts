import { Store } from '../../database/store';
import type { Conversation } from '../../types';
import { AITasks } from '../ai/tasks';
import { effectiveBehavior } from '../chat/config';
import { ParticipantAliases } from '../chat/participants';
import { transcript } from './format';

export class SummaryService {
    constructor(private readonly store: Store, private readonly tasks: AITasks) {}

    async compressOlder(conversation: Conversation, currentStartSeq: number): Promise<void> {
        const summary = await this.store.getSummary(conversation.id);
        const keep = Math.max(2, Math.floor(effectiveBehavior(conversation).recentMessageCount / 2));
        const through = currentStartSeq - keep - 1;
        const from = summary.coveredThroughSeq + 1;
        if (through - from + 1 < 4) return;
        const messages = await this.store.getMessagesThrough(conversation.id, from, through);
        if (!messages.length) return;
        const aliases = new ParticipantAliases(messages);
        const content = await this.tasks.summarize(summary.content, transcript(messages, aliases), conversation);
        await this.store.saveSummary(conversation.id, content, summary.coveredThroughSeq, through);
    }
}
