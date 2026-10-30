import type { ProviderProfile } from '../types';

export type ProviderRole = 'system' | 'user' | 'assistant' | 'tool';

export type ProviderContentPart =
    | { type: 'text'; text: string }
    | { type: 'image'; mime: string; data: string };

export interface ProviderToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    /** Provider-private data used only by the originating adapter. */
    raw?: unknown;
}

export interface ProviderMessage {
    role: ProviderRole;
    content: ProviderContentPart[];
    toolCalls?: ProviderToolCall[];
    toolCallId?: string;
    toolName?: string;
    /** Provider-private data used only by the originating adapter. */
    raw?: unknown;
}

export interface ProviderToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ProviderRequest {
    profile: ProviderProfile;
    messages: ProviderMessage[];
    tools?: ProviderToolDefinition[];
    responseSchema?: Record<string, unknown>;
    signal?: AbortSignal;
    stream?: boolean;
}

export interface ProviderResponse {
    text: string;
    toolCalls: ProviderToolCall[];
    usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens?: number;
        thoughtTokens?: number;
        totalTokens?: number;
    };
    finishReason: string;
    /** Provider-private data used only by the originating adapter. */
    raw?: unknown;
}

export interface ProviderAdapter {
    generate(request: ProviderRequest): Promise<ProviderResponse>;
    generateStream?(request: ProviderRequest): Promise<ProviderResponse>;
}

export class ProviderError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly contextOverflow: boolean,
        readonly retryable: boolean,
    ) {
        super(message);
        this.name = 'ProviderError';
    }
}

export const textPart = (text: string): ProviderContentPart => ({ type: 'text', text });
export const textMessage = (role: ProviderRole, text: string): ProviderMessage => ({ role, content: [textPart(text)] });
