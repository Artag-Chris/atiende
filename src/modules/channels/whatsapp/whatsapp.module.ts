import { Module } from '@nestjs/common';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { CHANNEL_PROVIDERS_TOKEN } from '@core/tokens';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

const channelProvider = {
  provide: CHANNEL_PROVIDERS_TOKEN,
  useFactory: (whatsapp: WhatsAppAdapter) => [whatsapp],
  inject: [WhatsAppAdapter],
  multi: true,
};

@Module({
  imports: [CoreModule, PostgresPersistenceModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppAdapter, channelProvider],
  exports: [WhatsAppAdapter, CHANNEL_PROVIDERS_TOKEN],
})
export class WhatsAppModule {}
