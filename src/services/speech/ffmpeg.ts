import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function tryExec(command: string, args: string[]): Promise<string | null> {
    try {
        const { stdout } = await run(command, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
        return stdout;
    } catch {
        return null;
    }
}

export async function probeDurationSeconds(file: string): Promise<number | null> {
    const output = await tryExec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    const value = Number(output?.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * QQ 语音需要 SILK(v3)，NapCat 无法直接转码时退回 AMR-NB。
 * 返回 null 表示本机没有可用的 ffmpeg 编码能力。
 */
export async function convertForQQ(input: string, output: string): Promise<boolean> {
    for (const codec of ['libopencore_amrnb', 'amr_nb']) {
        const result = await tryExec('ffmpeg', ['-y', '-v', 'error', '-i', input, '-ar', '8000', '-ac', '1', '-c:a', codec, output]);
        if (result !== null) return true;
    }
    return false;
}

export async function convertToMp3(input: string, output: string): Promise<boolean> {
    const result = await tryExec('ffmpeg', ['-y', '-v', 'error', '-i', input, '-c:a', 'libmp3lame', '-q:a', '4', output]);
    return result !== null;
}
