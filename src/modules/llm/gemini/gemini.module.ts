import { Global, Module } from '@nestjs/common';
import { AI_CONFIG_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import type { Features } from '@config/features';
import { GeminiAdapter } from './gemini.adapter';
import { providerBlockFor } from '../provider-config';

/**
 * Registra el GeminiAdapter con el bloque de configuración que le corresponde
 * (primary si Gemini es el provider principal, fallback en caso contrario).
 * No registra los tokens de rol — esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: GeminiAdapter,
      useFactory: (features: Features, aiConfig: AIConfig) =>
        new GeminiAdapter(providerBlockFor(features, aiConfig, 'gemini')),
      inject: [FEATURES_TOKEN, AI_CONFIG_TOKEN],
    },
  ],
  exports: [GeminiAdapter],
})
export class GeminiModule {}
