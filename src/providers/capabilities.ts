import type { ProviderProfile } from '../types';

export interface ProviderCapabilities {
    chat: boolean;
    vision: boolean;
    tts: boolean;
    stt: boolean;
}

/**
 * 能力优先由协议与模型名推导，手动声明只作为覆盖。
 * Fish Audio 是语音专用协议；Gemini 的 -tts 系列与 OpenAI 的 tts/whisper 系列 likewise 不可作为聊天模型。
 */
export function capabilitiesOf(profile: ProviderProfile): ProviderCapabilities {
    const model = (profile.model || '').toLocaleLowerCase();
    if (profile.type === 'fishaudio') {
        // Fish Audio 只配置一个模型：transcribe 系列是转写模型，其余为语音合成模型。
        const transcribe = model.startsWith('transcribe');
        return { chat: false, vision: false, tts: !transcribe, stt: transcribe };
    }
    const audioChat = /audio/i.test(model) && !/whisper|transcribe/i.test(model);
    const ttsDetected = model.includes('tts') && !audioChat;
    const sttDetected = /whisper|transcribe|asr/i.test(model);
    const ttsOnly = profile.tts === true || ttsDetected;
    return {
        chat: !ttsOnly && !sttDetected,
        vision: profile.type === 'anthropic' ? false : Boolean(profile.vision) && !ttsOnly && !sttDetected,
        tts: ttsOnly,
        stt: profile.speechRecognition === true || sttDetected || (audioChat && profile.type !== 'anthropic'),
    };
}

export function isTtsOnly(profile: ProviderProfile): boolean {
    const capabilities = capabilitiesOf(profile);
    return capabilities.tts && !capabilities.chat;
}

/** 语音专用配置（Fish Audio、TTS、Whisper 等）不能承担文本任务。 */
export function isSpeechOnly(profile: ProviderProfile): boolean {
    return !capabilitiesOf(profile).chat;
}
