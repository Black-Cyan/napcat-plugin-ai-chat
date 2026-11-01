export type FishSegment =
    | { kind: 'speech'; text: string; emphasis: boolean }
    | { kind: 'pause'; ms: number };

/**
 * Fish Audio 的细粒度朗读控制标记：
 * - [停顿] / [停顿 0.5s] / [停顿500ms] / [停顿 1 秒]：真实静音间隔
 * - [加重]…[/加重]（同义：[强调]…[/强调]）：该段提高音量并略微放慢
 * 这些标记由插件实现，不会原样送进 TTS 文本，避免被朗读出来。
 */
export function parseFishMarkup(input: string): FishSegment[] {
    const segments: FishSegment[] = []
    const pattern = /\[(停顿|暂停)(?:\s*([\d.]+)\s*(ms|毫秒|s|秒|秒钟)?)?\]|(\[加重\]|\[强调\]|\[\/加重\]|\[\/强调\])/g
    let cursor = 0
    let emphasis = false
    const pushSpeech = (text: string) => {
        const value = text.trim()
        if (value) segments.push({ kind: 'speech', text: value, emphasis })
    }
    for (const match of input.matchAll(pattern)) {
        const index = match.index ?? 0
        const token = match[0]
        pushSpeech(input.slice(cursor, index))
        cursor = index + token.length
        if (match[1]) {
            const amount = match[2] ? Number(match[2]) : 0.4
            const unit = match[3] ?? 's'
            const ms = unit === 'ms' || unit === '毫秒' ? amount : amount * 1000
            segments.push({ kind: 'pause', ms: Math.min(Math.max(ms, 100), 5000) })
        } else {
            emphasis = token === '[加重]' || token === '[强调]'
        }
    }
    pushSpeech(input.slice(cursor))
    return segments
}

export function hasFineControl(segments: FishSegment[]): boolean {
    return segments.some((segment) => segment.kind === 'pause' || segment.emphasis)
}

/** 没有 ffmpeg 时的降级：停顿改成省略号，去掉加重标记，保留完整语义。 */
export function flattenMarkup(segments: FishSegment[]): string {
    return segments.map((segment) => segment.kind === 'pause' ? '……' : segment.text).join('').replace(/\s+/g, ' ').trim()
}
