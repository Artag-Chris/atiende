import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import type { Features } from '@config/features';
import { GroqAdapter } from './groq.adapter';
import { providerBlockFor } from '../provider-config';

/**
 * Registra el GroqAdapter con el bloque de configuración que le corresponde
 * (primary si Groq es el provider principal, fallback en caso contrario).
 * No registra los tokens de rol — esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: GroqAdapter,
      useFactory: (features: Features, aiConfig: AIConfig, configService: ConfigService) =>
        new GroqAdapter(providerBlockFor(features, aiConfig, 'groq'), configService),
      inject: [FEATURES_TOKEN, AI_CONFIG_TOKEN, ConfigService],
    },
  ],
  exports: [GroqAdapter],
})
export class GroqModule {}
