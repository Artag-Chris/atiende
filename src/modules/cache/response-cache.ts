import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '@core/tokens';

@Injectable()
export class ResponseCache implements OnModuleDestroy {
  private readonly logger = new Logger(ResponseCache.name);
  private readonly prefix = 'atiende:cache:response:';
  private readonly defaultTtlSec = 3600; // 1 hour

  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis) {}

  private buildKey(businessId: string, userMessage: string): string {
    const hash = createHash('sha256')
      .update(`${businessId}:${userMessage.toLowerCase().trim()}`)
      .digest('hex')
      .slice(0, 16);
    return `${this.prefix}${hash}`;
  }

  async get(businessId: string, userMessage: string): Promise<string | null> {
    const key = this.buildKey(businessId, userMessage);
    const result = await this.redis.get(key);
    if (result) {
      this.logger.debug(`Cache hit for ${key}`);
    }
    return result;
  }

  async set(businessId: string, userMessage: string, response: string, ttlSec?: number): Promise<void> {
    const key = this.buildKey(businessId, userMessage);
    await this.redis.setex(key, ttlSec ?? this.defaultTtlSec, response);
    this.logger.debug(`Cached response for ${key}`);
  }

  async invalidate(businessId: string): Promise<void> {
    const pattern = `${this.prefix}*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`Invalidated ${keys.length} cached responses for ${businessId}`);
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
