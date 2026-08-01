import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { QueueModule } from '@modules/queue/queue.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

@Global()
@Module({
  imports: [CoreModule, PostgresPersistenceModule, QueueModule],
  controllers: [WhatsAppController],
  providers: [
    {
      provide: WhatsAppAdapter,
      useFactory: (configService: ConfigService) => new WhatsAppAdapter(configService),
      inject: [ConfigService],
    },
  ],
  exports: [WhatsAppAdapter],
})
export class WhatsAppModule {}
