import { Global, Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';
import {
  LLM_PRIMARY_PROVIDER_TOKEN,
  LLM_PROVIDER_FALLBACK_TOKEN,
  LLM_PROVIDER_TOKEN,
} from '@core/tokens';
import type { LLMProviderName } from '@config/ai.config';
import type { LLMProviderPort } from '@core/ports/llm-provider.port';
import { GroqAdapter } from '../groq/groq.adapter';
import { KimiAdapter } from '../kimi/kimi.adapter';
import { OpenAIAdapter } from '../openai/openai.adapter';
import { GeminiAdapter } from '../gemini/gemini.adapter';
import { MockLLMAdapter } from '../mock/mock-llm.adapter';
import { CircuitBreakerService } from './circuit-breaker.service';
import { LLMRouterService } from './llm-router.service';

function adapterClassFor(provider: LLMProviderName): Type<LLMProviderPort> {
  switch (provider) {
    case 'groq':
      return GroqAdapter;
    case 'kimi':
      return KimiAdapter;
    case 'openai':
      return OpenAIAdapter;
    case 'gemini':
      return GeminiAdapter;
    default:
      // 'claude' (sin adapter implementado) y 'mock' caen al mock.
      return MockLLMAdapter;
  }
}

/**
 * Ata los adapters concretos a los tokens de rol (primario/fallback) y expone
 * LLMRouterService como LLM_PROVIDER_TOKEN. Los adapters los proveen los
 * módulos provider (GroqModule, KimiModule, ...) con su bloque de config.
 */
@Global()
@Module({})
export class LLMRouterModule {
  static forRoot(primary: LLMProviderName, fallback: LLMProviderName | null): DynamicModule {
    const providers: Provider[] = [
      LLMRouterService,
      CircuitBreakerService,
      { provide: LLM_PRIMARY_PROVIDER_TOKEN, useExisting: adapterClassFor(primary) },
      { provide: LLM_PROVIDER_TOKEN, useExisting: LLMRouterService },
    ];

    if (fallback) {
      providers.push({
        provide: LLM_PROVIDER_FALLBACK_TOKEN,
        useExisting: adapterClassFor(fallback),
      });
    }

    return {
      module: LLMRouterModule,
      global: true,
      providers,
      exports: [LLM_PROVIDER_TOKEN],
    };
  }
}
