export type LogCategory = 'chat' | 'model' | 'tool' | 'system' | 'access';

export interface RuntimeLogEntry {
    id: number;
    time: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    category?: LogCategory;
    message: string;
    details?: unknown;
}

class LogBuffer {
    private entries: RuntimeLogEntry[] = [];
    private nextId = 1;

    add(level: RuntimeLogEntry['level'], message: string, category?: LogCategory, details?: unknown): void {
        this.entries.push({
            id: this.nextId++,
            time: Date.now(),
            level,
            category,
            message: message.slice(0, 500),
            details: details !== undefined ? sanitizeLogDetails(details) : undefined,
        });
        const max = 500;
        if (this.entries.length > max) this.entries.splice(0, this.entries.length - max);
    }

    list(): RuntimeLogEntry[] {
        return [...this.entries].reverse();
    }

    clear(): void {
        this.entries = [];
    }
}

export function sanitizeLogDetails(data: unknown): unknown {
    if (typeof data === 'string') {
        return data
            .replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"']+/gi, '[数据库连接串已隐藏]')
            .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
            .replace(/((?:api[_-]?key|password|token|secret)\s*[:=]\s*)[^\s,;"']+/gi, '$1[已隐藏]');
    }
    if (Array.isArray(data)) return data.map(sanitizeLogDetails);
    if (typeof data === 'object' && data !== null) {
        const copy: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
            if (/key|secret|password|token/i.test(k) && typeof v === 'string') {
                copy[k] = '[已隐藏]';
            } else {
                copy[k] = sanitizeLogDetails(v);
            }
        }
        return copy;
    }
    return data;
}

export const runtimeLogs = new LogBuffer();
