import { beforeEach, describe, expect, it } from 'vitest';
import { runtimeLogs, sanitizeLogDetails } from '../core/log-buffer';
import { pluginState } from '../core/state';

describe('Debug logging and secret sanitization', () => {
    beforeEach(() => {
        runtimeLogs.clear();
    });

    it('sanitizes api keys, passwords, and tokens from details objects and strings', () => {
        const raw = {
            apiKey: 'sk-secret-12345678',
            headers: {
                Authorization: 'Bearer secret-token-xyz',
                'x-goog-api-key': 'AIzaSySecretKey',
            },
            databaseUri: 'postgresql://postgres:mypassword123@localhost:5432/db',
            prompt: 'Hello world',
        };

        const sanitized = sanitizeLogDetails(raw) as any;
        expect(sanitized.apiKey).toBe('[已隐藏]');
        expect(sanitized.headers['x-goog-api-key']).toBe('[已隐藏]');
        expect(sanitized.headers.Authorization).toBe('Bearer [已隐藏]');
        expect(sanitized.databaseUri).toBe('[数据库连接串已隐藏]');
        expect(sanitized.prompt).toBe('Hello world');
    });

    it('stores structured log entries with category and details', () => {
        runtimeLogs.add('debug', '调用模型 [test-model]', 'model', {
            model: 'gemini-2.0-flash',
            messages: [{ role: 'user', content: 'test message' }],
        });

        const list = runtimeLogs.list();
        expect(list).toHaveLength(1);
        expect(list[0].level).toBe('debug');
        expect(list[0].category).toBe('model');
        expect(list[0].message).toBe('调用模型 [test-model]');
        expect(list[0].details).toEqual({
            model: 'gemini-2.0-flash',
            messages: [{ role: 'user', content: 'test message' }],
        });
    });
});
