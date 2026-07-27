import { Module } from '@nestjs/common';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

@Module({
  imports: [CoreModule, PostgresPersistenceModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppAdapter],
  exports: [WhatsAppAdapter],
})
export class WhatsAppModule {}
