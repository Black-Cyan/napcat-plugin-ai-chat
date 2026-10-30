import Jimp from 'jimp';
import type {
    ProviderAdapter,
    ProviderContentPart,
    ProviderMessage,
    ProviderRequest,
    ProviderResponse,
} from '../types';
import { ProviderError } from '../types';
import { googleGenerationUrl, googleJson, googleSse } from './http';
import { selectGoogleModel, type GoogleModelInfo } from './models';

interface GooglePart {
    text?: string;
    thought?: boolean;
    thoughtSignature?: string;
    inlineData?: { mimeType: string; data: string };
    functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
    [key: string]: unknown;
}

interface GoogleContent {
    role?: string;
    parts: GooglePart[];
}

export class GoogleAdapter implements ProviderAdapter {
    async generate(request: ProviderRequest): Promise<ProviderResponse> {
        return this.execute(request, false);
    }

    async generateStream(request: ProviderRequest): Promise<ProviderResponse> {
        return this.execute(request, true);
    }

    private async execute(request: ProviderRequest, stream: boolean): Promise<ProviderResponse> {
        const model = await selectGoogleModel(request.profile);
        const body = await buildGoogleBody(request, model);
        const url = googleGenerationUrl(request.profile, model.name, stream);
        if (!stream) {
            const payload = await googleJson(url, request.profile, { body, signal: request.signal });
            return parseGoogleResponse(payload);
        }
        const parts: GooglePart[] = [];
        let usageMetadata: Record<string, unknown> = {};
        let promptFeedback: Record<string, unknown> | undefined;
        let finishReason = '';
        await googleSse(url, request.profile, { body, signal: request.signal }, (chunk) => {
            if (chunk.promptFeedback) promptFeedback = chunk.promptFeedback;
            if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
            const candidate = chunk.candidates?.[0];
            if (Array.isArray(candidate?.content?.parts)) parts.push(...candidate.content.parts);
            if (candidate?.finishReason) finishReason = String(candidate.finishReason);
        });
        return parseGoogleResponse({
            candidates: [{ content: { role: 'model', parts }, finishReason }],
            usageMetadata,
            ...(promptFeedback ? { promptFeedback } : {}),
        });
    }
}

async function buildGoogleBody(request: ProviderRequest, model: GoogleModelInfo): Promise<Record<string, unknown>> {
    const system = request.messages.filter((message) => message.role === 'system')
        .flatMap((message) => message.content).filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
    const generationConfig: Record<string, unknown> = {
        temperature: request.profile.temperature,
        maxOutputTokens: model.outputTokenLimit > 0
            ? Math.min(request.profile.maxOutputTokens, model.outputTokenLimit)
            : request.profile.maxOutputTokens,
    };
    if (request.responseSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = stripUnsupportedSchemaKeywords(request.responseSchema);
    }
    const contents = await googleContents(request.messages.filter((message) => message.role !== 'system'));
    if (!contents.length) throw new ProviderError('Google 请求缺少对话内容', 400, false, false);
    const body: Record<string, unknown> = { contents, generationConfig };
    if (system.trim()) body.systemInstruction = { role: 'user', parts: [{ text: system }] };
    if (request.tools?.length) {
        body.tools = [{
            functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.parameters,
            })),
        }];
    }
    return body;
}

async function googleContents(messages: ProviderMessage[]): Promise<GoogleContent[]> {
    const contents: GoogleContent[] = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'tool') {
            const parts: GooglePart[] = [];
            while (index < messages.length && messages[index].role === 'tool') {
                parts.push(functionResponsePart(messages[index]));
                index += 1;
            }
            index -= 1;
            contents.push({ role: 'user', parts });
            continue;
        }
        if (message.role === 'assistant' && isGoogleContent(message.raw)) {
            contents.push({ ...message.raw, role: 'model' });
            continue;
        }
        const parts = await Promise.all(message.content.map(googlePart));
        if (message.role === 'assistant' && message.toolCalls?.length) {
            parts.push(...message.toolCalls.map((call) => isGooglePart(call.raw)
                ? call.raw
                : { functionCall: { name: call.name, args: call.arguments } }));
        }
        contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
    }
    return contents;
}

async function googlePart(part: ProviderContentPart): Promise<GooglePart> {
    if (part.type === 'text') return { text: part.text };
    if (part.mime === 'image/gif') {
        try {
            const image = await Jimp.read(Buffer.from(part.data, 'base64'));
            const png = await image.getBufferAsync(Jimp.MIME_PNG);
            return { inlineData: { mimeType: 'image/png', data: png.toString('base64') } };
        } catch {
            throw new ProviderError('无法将 GIF 转换为 Gemini 支持的 PNG 图片', 400, false, false);
        }
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(part.mime)) {
        throw new ProviderError(`Gemini 不支持内联图片类型 ${part.mime}`, 400, false, false);
    }
    return { inlineData: { mimeType: part.mime, data: part.data } };
}

function functionResponsePart(message: ProviderMessage): GooglePart {
    const raw = isGooglePart(message.raw) ? message.raw : undefined;
    const id = raw?.functionCall?.id;
    const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
    return {
        functionResponse: {
            ...(id ? { id } : {}),
            name: message.toolName ?? '',
            response: { result: parseToolResult(text) },
        },
    };
}

function parseGoogleResponse(payload: any): ProviderResponse {
    const blockReason = payload.promptFeedback?.blockReason;
    if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
        throw new ProviderError(`Google 已阻止该提示词（${String(blockReason)}）`, 400, false, false);
    }
    const candidate = payload.candidates?.[0];
    const finishReason = String(candidate?.finishReason ?? '');
    if (['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'SPII', 'BLOCKLIST'].includes(finishReason)) {
        throw new ProviderError(`Google 响应被安全策略终止（${finishReason}）`, 400, false, false);
    }
    if (finishReason === 'MAX_TOKENS') throw new ProviderError('Google 输出达到最大 token 限制', 400, false, false);
    if (finishReason === 'CONTINUATION') throw new ProviderError('Google 响应尚未完成，需要继续生成', 400, false, false);
    const content = candidate?.content as GoogleContent | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const toolCalls = parts.filter((part) => part.functionCall).map((part, index) => ({
        id: String(part.functionCall?.id || `google-${index}-${part.functionCall?.name ?? 'tool'}`),
        name: String(part.functionCall?.name ?? ''),
        arguments: part.functionCall?.args ?? {},
        raw: part,
    })).filter((call) => call.name);
    const text = parts.filter((part) => part.thought !== true && typeof part.text === 'string')
        .map((part) => part.text).join('');
    if (!text && !toolCalls.length) throw new ProviderError('Google 未返回可用的文本或工具调用', 502, false, false);
    const usage = payload.usageMetadata ?? {};
    const inputTokens = Number(usage.promptTokenCount ?? 0);
    const candidatesTokens = Number(usage.candidatesTokenCount ?? 0);
    const thoughtTokens = Number(usage.thoughtsTokenCount ?? 0);
    return {
        text,
        toolCalls,
        usage: {
            inputTokens,
            outputTokens: candidatesTokens + thoughtTokens,
            cachedInputTokens: Number(usage.cachedContentTokenCount ?? 0),
            thoughtTokens,
            totalTokens: Number(usage.totalTokenCount ?? inputTokens + candidatesTokens + thoughtTokens),
        },
        finishReason,
        raw: content ? { ...content, role: 'model' } : undefined,
    };
}

function parseToolResult(text: string): unknown {
    try { return JSON.parse(text); } catch { return text; }
}

function isGoogleContent(value: unknown): value is GoogleContent {
    return typeof value === 'object' && value !== null && Array.isArray((value as GoogleContent).parts);
}

function isGooglePart(value: unknown): value is GooglePart {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUnsupportedSchemaKeywords(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripUnsupportedSchemaKeywords);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'additionalProperties' && key !== '$schema')
        .map(([key, child]) => [key, stripUnsupportedSchemaKeywords(child)]));
}
