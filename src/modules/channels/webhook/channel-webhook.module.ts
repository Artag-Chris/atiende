import { Global, Module } from '@nestjs/common';
import { CoreModule } from '@core/core.module';
import { PostgresPersistenceModule } from '@modules/persistence/postgres/postgres-persistence.module';
import { QueueModule } from '@modules/queue/queue.module';
import { RedisModule } from '@modules/infrastructure/redis/redis.module';
import { ChannelWebhookService } from './channel-webhook.service';

@Global()
@Module({
  imports: [CoreModule, PostgresPersistenceModule, QueueModule, RedisModule],
  providers: [ChannelWebhookService],
  exports: [ChannelWebhookService],
})
export class ChannelWebhookModule {}
