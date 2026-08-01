import { Global, Module } from '@nestjs/common';
import type { ChannelProviderPort } from '@core/ports/channel-provider.port';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { WhatsAppAdapter } from '../whatsapp/whatsapp.adapter';
import { ChannelRouterService } from './channel-router.service';

/**
 * Router de canales (receta de LLMRouterModule).
 *
 * CHANNEL_PROVIDERS_TOKEN se expone como array de providers via factory
 * agregador. NestJS no soporta `multi: true` en custom providers, así que cada
 * adapter se inyecta con `optional: true` y los habilitados se agregan aquí.
 * Los módulos de canal (WhatsAppModule, InstagramModule en Fase 1, ...) solo
 * proveen su adapter como clase; este módulo hace el wiring.
 */
@Global()
@Module({
  providers: [
    ChannelRouterService,
    {
      provide: CHANNEL_PROVIDERS_TOKEN,
      useFactory: (whatsapp?: WhatsAppAdapter): ChannelProviderPort[] => {
        const providers: ChannelProviderPort[] = [];
        if (whatsapp) providers.push(whatsapp);
        return providers;
      },
      inject: [{ token: WhatsAppAdapter, optional: true }],
    },
  ],
  exports: [ChannelRouterService],
})
export class ChannelRouterModule {}
