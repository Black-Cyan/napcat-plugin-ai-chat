import { runtime } from '../core/runtime';

export async function handleMessage(_ctx: unknown, event: unknown): Promise<void> {
    await runtime.onMessage(event);
}

export {
    textSegment,
    atSegment,
    imageSegment,
    replySegment,
} from '../napcat/message-segments';
export { sendMessage } from '../napcat/actions';
