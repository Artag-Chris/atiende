import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { REDIS_CLIENT_TOKEN } from '@core/tokens';
import { RedisLockService } from './redis-lock.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT_TOKEN,
      useFactory: (config: ConfigService) => {
        return new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD') || undefined,
          tls: config.get('REDIS_TLS') === 'true' ? {} : undefined,
          keyPrefix: config.get('REDIS_PREFIX', 'atiende:dev') + ':',
          maxRetriesPerRequest: 3,
          retryStrategy(times: number) {
            const delay = Math.min(times * 200, 5000);
            return delay;
          },
        });
      },
      inject: [ConfigService],
    },
    RedisLockService,
  ],
  exports: [REDIS_CLIENT_TOKEN, RedisLockService],
})
export class RedisModule {}
