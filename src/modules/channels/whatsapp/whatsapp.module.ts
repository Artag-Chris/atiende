import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { QueueModule } from '@modules/queue/queue.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppAdapter } from './whatsapp.adapter';

@Global()
@Module({
  imports: [
    CoreModule,
    PostgresPersistenceModule,
    QueueModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 600 }],
    }),
  ],
  controllers: [WhatsAppController],
  providers: [WhatsAppAdapter, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [WhatsAppAdapter],
})
export class WhatsAppModule {}
