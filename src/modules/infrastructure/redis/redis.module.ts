import { Global, Module, Logger } from '@nestjs/common';
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
        const logger = new Logger('RedisModule');

        const client = new Redis({
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
          lazyConnect: true,
        });

        client
          .connect()
          .then(() => {
            logger.log('Redis connected successfully');
            return client.ping().then(() => logger.log('Redis PING OK'));
          })
          .catch((err: Error) => {
            logger.warn(`Redis connection failed: ${err.message}. Cache disabled.`);
            logger.warn('Start Redis via: docker compose up -d redis');
          });

        client.on('error', (err: Error) => {
          logger.warn(`Redis client error: ${err.message}`);
        });

        client.on('close', () => {
          logger.warn('Redis connection closed');
        });

        return client;
      },
      inject: [ConfigService],
    },
    RedisLockService,
  ],
  exports: [REDIS_CLIENT_TOKEN, RedisLockService],
})
export class RedisModule {}
