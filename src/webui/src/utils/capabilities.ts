import type { ProviderProfile } from '../types'

export interface ProviderCapabilities {
    chat: boolean
    vision: boolean
    tts: boolean
    stt: boolean
}

/** 与后端一致的推导规则：协议与模型名优先，手动声明仅作覆盖。 */
export function capabilitiesOf(profile: ProviderProfile): ProviderCapabilities {
    const model = (profile.model || '').toLocaleLowerCase()
    if (profile.type === 'fishaudio') {
        const transcribe = model.startsWith('transcribe')
        return { chat: false, vision: false, tts: !transcribe, stt: transcribe }
    }
    const audioChat = /audio/i.test(model) && !/whisper|transcribe/i.test(model)
    const ttsDetected = model.includes('tts') && !audioChat
    const sttDetected = /whisper|transcribe|asr/i.test(model)
    const ttsOnly = profile.tts === true || ttsDetected
    return {
        chat: !ttsOnly && !sttDetected,
        vision: profile.type === 'anthropic' ? false : Boolean(profile.vision) && !ttsOnly && !sttDetected,
        tts: ttsOnly,
        stt: profile.speechRecognition === true || sttDetected || (audioChat && profile.type !== 'anthropic'),
    }
}

export function isSpeechOnly(profile: ProviderProfile): boolean {
    return !capabilitiesOf(profile).chat
}

export function isTtsOnly(profile: ProviderProfile): boolean {
    const capabilities = capabilitiesOf(profile)
    return capabilities.tts && !capabilities.chat
}

/** 自动推导出的用途标签，仅在用户没有手动覆盖时展示。 */
export function autoUsageLabels(profile: ProviderProfile): string[] {
    const model = (profile.model || '').toLocaleLowerCase()
    if (profile.type === 'fishaudio') return [model.startsWith('transcribe') ? '语音转写' : '语音合成']
    const labels: string[] = []
    if (profile.tts !== true && model.includes('tts') && !/audio/i.test(model)) labels.push('语音合成（自动）')
    if (profile.speechRecognition !== true && /whisper|transcribe|asr/i.test(model)) labels.push('语音转写（自动）')
    return labels
}
