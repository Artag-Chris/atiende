import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import type { Features } from '@config/features';
import { DeepSeekAdapter } from './deepseek.adapter';
import { providerBlockFor } from '../provider-config';

/**
 * Registra el DeepSeekAdapter con el bloque de configuración que le corresponde
 * (primary si DeepSeek es el provider principal, fallback en caso contrario).
 * No registra los tokens de rol — esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: DeepSeekAdapter,
      useFactory: (features: Features, aiConfig: AIConfig, configService: ConfigService) =>
        new DeepSeekAdapter(providerBlockFor(features, aiConfig, 'deepseek'), configService),
      inject: [FEATURES_TOKEN, AI_CONFIG_TOKEN, ConfigService],
    },
  ],
  exports: [DeepSeekAdapter],
})
export class DeepSeekModule {}
