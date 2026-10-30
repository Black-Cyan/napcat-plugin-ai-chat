import type { ProviderProfile } from '../types';
import type { ProviderAdapter } from './types';
import { OpenAIAdapter, AnthropicAdapter, GoogleAdapter } from './http';

export class ProviderRegistry {
    constructor(private readonly getProfiles: () => ProviderProfile[]) {}

    profile(id: string | null | undefined): ProviderProfile {
        const profiles = this.getProfiles();
        if (id) {
            const selected = profiles.find((item) => item.id === id);
            if (!selected) throw new Error('指定的模型配置不存在');
            return selected;
        }
        const profile = profiles[0];
        if (!profile) throw new Error('尚未配置模型');
        return profile;
    }

    byId(id: string): ProviderProfile | null {
        return this.getProfiles().find((item) => item.id === id) ?? null;
    }

    adapter(profile: ProviderProfile): ProviderAdapter {
        if (profile.type === 'openai') return new OpenAIAdapter();
        if (profile.type === 'anthropic') return new AnthropicAdapter();
        return new GoogleAdapter();
    }

    generate(profile: ProviderProfile, request: Parameters<ProviderAdapter['generate']>[0]) {
        const adapter = this.adapter(profile);
        if (request.stream && adapter.generateStream) return adapter.generateStream({ ...request, profile });
        return adapter.generate({ ...request, profile });
    }
}
