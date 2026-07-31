import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from '@config/queue.config';
import { InboundProcessor } from './inbound.processor';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD') || undefined,
          tls: config.get('REDIS_TLS') === 'true' ? {} : undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        prefix: config.get('BULLMQ_QUEUE_PREFIX', 'atiende:dev:queue'),
      }),
    }),
    BullModule.registerQueue(
      {
        name: QUEUE_NAMES.INBOUND_MESSAGE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 1000, age: 7 * 24 * 60 * 60 },
          removeOnFail: { count: 5000, age: 30 * 24 * 60 * 60 },
        },
      },
      {
        name: QUEUE_NAMES.OUTBOUND_MESSAGE,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000, age: 7 * 24 * 60 * 60 },
          removeOnFail: { count: 5000, age: 30 * 24 * 60 * 60 },
        },
      },
      {
        name: QUEUE_NAMES.MAINTENANCE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 100, age: 7 * 24 * 60 * 60 },
          removeOnFail: { count: 500, age: 30 * 24 * 60 * 60 },
        },
      },
    ),
  ],
  providers: [InboundProcessor],
  exports: [BullModule],
})
export class QueueModule {}
