import { Module } from '@nestjs/common';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppAdapter,
    {
      provide: CHANNEL_PROVIDERS_TOKEN,
      useExisting: WhatsAppAdapter,
      multi: true,
    },
  ],
  exports: [WhatsAppAdapter, CHANNEL_PROVIDERS_TOKEN],
})
export class WhatsAppModule {}
