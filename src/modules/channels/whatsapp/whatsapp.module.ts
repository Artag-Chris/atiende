import { Module } from '@nestjs/common';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

const channelProvider = {
  provide: CHANNEL_PROVIDERS_TOKEN,
  useExisting: WhatsAppAdapter,
  multi: true,
};

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppAdapter, channelProvider],
  exports: [WhatsAppAdapter, CHANNEL_PROVIDERS_TOKEN],
})
export class WhatsAppModule {}
