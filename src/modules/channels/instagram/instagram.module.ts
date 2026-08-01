import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { QueueModule } from '@modules/queue/queue.module';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import { InstagramController } from './instagram.controller';
import { InstagramAdapter } from './instagram.adapter';

@Global()
@Module({
  imports: [CoreModule, PostgresPersistenceModule, QueueModule],
  controllers: [InstagramController],
  providers: [
    {
      provide: InstagramAdapter,
      useFactory: (configService: ConfigService, crypto: CryptoService) =>
        new InstagramAdapter(configService, crypto),
      inject: [ConfigService, CryptoService],
    },
  ],
  exports: [InstagramAdapter],
})
export class InstagramModule {}
