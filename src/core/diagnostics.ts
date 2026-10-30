export function safeDiagnostic(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '未知错误');
    return message
        .replace(/(?:postgres(?:ql)?|mysql):\/\/[^\s"']+/gi, '[数据库连接串已隐藏]')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
        .replace(/((?:api[_-]?key|password|token|secret)\s*[:=]\s*)[^\s,;"']+/gi, '$1[已隐藏]')
        .slice(0, 500);
}
