import { Global, Module } from '@nestjs/common';
import { AI_CONFIG_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import type { Features } from '@config/features';
import { OpenAIAdapter } from './openai.adapter';
import { providerBlockFor } from '../provider-config';

/**
 * Registra el OpenAIAdapter con el bloque de configuración que le corresponde
 * (primary si OpenAI es el provider principal, fallback en caso contrario).
 * No registra los tokens de rol — esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: OpenAIAdapter,
      useFactory: (features: Features, aiConfig: AIConfig) =>
        new OpenAIAdapter(providerBlockFor(features, aiConfig, 'openai')),
      inject: [FEATURES_TOKEN, AI_CONFIG_TOKEN],
    },
  ],
  exports: [OpenAIAdapter],
})
export class OpenAIModule {}
