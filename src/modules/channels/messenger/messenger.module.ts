import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { QueueModule } from '@modules/queue/queue.module';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import { MessengerController } from './messenger.controller';
import { MessengerAdapter } from './messenger.adapter';

@Global()
@Module({
  imports: [CoreModule, PostgresPersistenceModule, QueueModule],
  controllers: [MessengerController],
  providers: [
    {
      provide: MessengerAdapter,
      useFactory: (configService: ConfigService, crypto: CryptoService) =>
        new MessengerAdapter(configService, crypto),
      inject: [ConfigService, CryptoService],
    },
  ],
  exports: [MessengerAdapter],
})
export class MessengerModule {}
