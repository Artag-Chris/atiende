import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_CONFIG_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import type { Features } from '@config/features';
import { KimiAdapter } from './kimi.adapter';
import { providerBlockFor } from '../provider-config';

/**
 * Registra el KimiAdapter con el bloque de configuración que le corresponde
 * (primary si Kimi es el provider principal, fallback en caso contrario).
 * No registra los tokens de rol — esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [
    {
      provide: KimiAdapter,
      useFactory: (features: Features, aiConfig: AIConfig, configService: ConfigService) =>
        new KimiAdapter(providerBlockFor(features, aiConfig, 'kimi'), configService),
      inject: [FEATURES_TOKEN, AI_CONFIG_TOKEN, ConfigService],
    },
  ],
  exports: [KimiAdapter],
})
export class KimiModule {}
