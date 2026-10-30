import type {
    ProviderAdapter,
    ProviderContentPart,
    ProviderMessage,
    ProviderRequest,
    ProviderResponse,
} from './types';
import { ProviderError } from './types';

export class OpenAIAdapter implements ProviderAdapter {
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
        const { profile } = request;
        const body: Record<string, unknown> = {
            model: profile.model,
            messages: request.messages.map(openAIMessage),
            temperature: profile.temperature,
            max_tokens: profile.maxOutputTokens,
        };
        if (request.tools?.length) body.tools = request.tools.map((tool) => ({
            type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
        if (request.responseSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: { name: 'response', strict: true, schema: request.responseSchema },
            };
        }
        const response = await fetchJson(endpoint(profile.baseUrl, 'https://api.openai.com/v1', '/chat/completions'), {
            Authorization: `Bearer ${profile.apiKey}`,
        }, body, request.signal);
        const choice = response.choices?.[0];
        const message = choice?.message ?? {};
        return {
            text: typeof message.content === 'string' ? message.content : '',
            toolCalls: (message.tool_calls ?? []).map((call: any, index: number) => ({
                id: String(call.id ?? `openai-${index}`),
                name: String(call.function?.name ?? ''),
                arguments: parseArguments(call.function?.arguments),
            })).filter((call: ProviderResponse['toolCalls'][number]) => call.name),
            usage: {
                inputTokens: Number(response.usage?.prompt_tokens ?? 0),
                outputTokens: Number(response.usage?.completion_tokens ?? 0),
            },
            finishReason: String(choice?.finish_reason ?? ''),
        };
    }
}

export class AnthropicAdapter implements ProviderAdapter {
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
        const { profile } = request;
        const system = request.messages.filter((message) => message.role === 'system')
            .map((message) => plainText(message.content)).join('\n\n');
        const schemaHint = request.responseSchema
            ? `\n只输出符合以下 JSON Schema 的 JSON，不要输出 Markdown：${JSON.stringify(request.responseSchema)}`
            : '';
        const body: Record<string, unknown> = {
            model: profile.model,
            max_tokens: profile.maxOutputTokens,
            temperature: profile.temperature,
            system: system + schemaHint,
            messages: request.messages.filter((message) => message.role !== 'system').map(anthropicMessage),
        };
        if (request.tools?.length) body.tools = request.tools.map((tool) => ({
            name: tool.name, description: tool.description, input_schema: tool.parameters,
        }));
        const anthropicRoot = (profile.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
        const anthropicUrl = anthropicRoot.endsWith('/v1') ? `${anthropicRoot}/messages` : `${anthropicRoot}/v1/messages`;
        const response = await fetchJson(anthropicUrl, {
            'x-api-key': profile.apiKey,
            'anthropic-version': '2023-06-01',
        }, body, request.signal);
        const content = Array.isArray(response.content) ? response.content : [];
        return {
            text: content.filter((part: any) => part.type === 'text').map((part: any) => part.text ?? '').join(''),
            toolCalls: content.filter((part: any) => part.type === 'tool_use').map((part: any, index: number) => ({
                id: String(part.id ?? `anthropic-${index}`), name: String(part.name ?? ''),
                arguments: typeof part.input === 'object' && part.input !== null ? part.input : {},
            })),
            usage: {
                inputTokens: Number(response.usage?.input_tokens ?? 0),
                outputTokens: Number(response.usage?.output_tokens ?? 0),
            },
            finishReason: String(response.stop_reason ?? ''),
        };
    }
}

export { GoogleAdapter } from './google/adapter';

function openAIMessage(message: ProviderMessage): Record<string, unknown> {
    if (message.role === 'tool') {
        return { role: 'tool', tool_call_id: message.toolCallId, content: plainText(message.content) };
    }
    if (message.role === 'assistant') {
        return {
            role: 'assistant', content: plainText(message.content),
            ...(message.toolCalls?.length ? {
                tool_calls: message.toolCalls.map((call) => ({
                    id: call.id, type: 'function',
                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                })),
            } : {}),
        };
    }
    if (message.role === 'system') return { role: 'system', content: plainText(message.content) };
    return {
        role: 'user',
        content: message.content.map((part) => part.type === 'text'
            ? { type: 'text', text: part.text }
            : { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } }),
    };
}

function anthropicMessage(message: ProviderMessage): Record<string, unknown> {
    if (message.role === 'tool') {
        return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: plainText(message.content) }],
        };
    }
    const content: Array<Record<string, unknown>> = message.content.map((part) => part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data } });
    if (message.role === 'assistant' && message.toolCalls?.length) {
        content.push(...message.toolCalls.map((call) => ({
            type: 'tool_use', id: call.id, name: call.name, input: call.arguments,
        })));
    }
    return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
}

function plainText(parts: ProviderContentPart[]): string {
    return parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
}

function parseArguments(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function endpoint(base: string | undefined, fallback: string, suffix: string): string {
    return `${(base || fallback).replace(/\/+$/, '')}${suffix}`;
}

async function fetchJson(url: string, headers: Record<string, string>, body: unknown, externalSignal?: AbortSignal): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await response.text();
        let payload: any = null;
        try { payload = text ? JSON.parse(text) : null; } catch { /* handled below */ }
        if (!response.ok) {
            const diagnostic = `${response.status} ${JSON.stringify(payload ?? text).slice(0, 1000)}`;
            const overflow = /context(?: length| window)?|too many tokens|maximum.*tokens|input.*too long/i.test(diagnostic)
                && /exceed|too (?:long|many)|maximum|limit|overflow/i.test(diagnostic);
            throw new ProviderError(
                overflow ? '模型上下文超出限制' : `模型请求失败（HTTP ${response.status}）`,
                response.status,
                overflow,
                response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
            );
        }
        if (!payload) throw new ProviderError('模型返回了无效响应', response.status, false, false);
        return payload;
    } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError('模型网络请求失败', 0, false, true);
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abort);
    }
}

function stripUnsupportedSchemaKeywords(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripUnsupportedSchemaKeywords);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'additionalProperties' && key !== '$schema')
        .map(([key, child]) => [key, stripUnsupportedSchemaKeywords(child)]));
}
