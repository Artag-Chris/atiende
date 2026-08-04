import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG_TOKEN, ANALYTICS_LLM_PROVIDER_TOKEN } from '@core/tokens';
import type { AIConfig, LLMProviderConfig } from '@config/ai.config';
import type { LLMProviderPort } from '@core/ports/llm-provider.port';
import { GroqAdapter } from '../groq/groq.adapter';
import { KimiAdapter } from '../kimi/kimi.adapter';
import { OpenAIAdapter } from '../openai/openai.adapter';
import { GeminiAdapter } from '../gemini/gemini.adapter';
import { MockLLMAdapter } from '../mock/mock-llm.adapter';

/**
 * Construye una instancia fresca del adapter para el LLM de analytics.
 * Los constructores difieren por provider (config y/o ConfigService), por eso
 * no se reutiliza `useExisting` de los módulos provider: esos registran UNA
 * instancia atada al router del agente, y aquí necesitamos un binding
 * independiente con su propio modelo/maxTokens.
 */
function createAnalyticsAdapter(
  config: LLMProviderConfig,
  configService: ConfigService,
): LLMProviderPort {
  switch (config.provider) {
    case 'groq':
      return new GroqAdapter(config, configService);
    case 'kimi':
      return new KimiAdapter(config, configService);
    case 'openai':
      return new OpenAIAdapter(config);
    case 'gemini':
      return new GeminiAdapter(config);
    default:
      // 'claude' (sin adapter implementado) y 'mock' caen al mock.
      return new MockLLMAdapter();
  }
}

/**
 * Binding del LLM del asesor de growth. SEPARADO del router del chat
 * (LLM_PROVIDER_TOKEN): se construye desde AIConfig.analytics, que por defecto
 * hereda el provider primario pero se puede apuntar a otra IA vía env
 * (ANALYTICS_LLM_*). El asesor nunca toca el pipeline del agente.
 */
@Global()
@Module({
  providers: [
    {
      provide: ANALYTICS_LLM_PROVIDER_TOKEN,
      useFactory: (aiConfig: AIConfig, configService: ConfigService) =>
        createAnalyticsAdapter(aiConfig.analytics, configService),
      inject: [AI_CONFIG_TOKEN, ConfigService],
    },
  ],
  exports: [ANALYTICS_LLM_PROVIDER_TOKEN],
})
export class AnalyticsLLMModule {}
