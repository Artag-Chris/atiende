import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT_TOKEN } from '@core/tokens';

const LOCK_PREFIX = 'atiende:lock:';
const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 50;
const MAX_RETRY_ATTEMPTS = 10;

@Injectable()
export class RedisLockService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);

  constructor(@Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs = DEFAULT_LOCK_TTL_MS): Promise<string | null> {
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fullKey = `${LOCK_PREFIX}${key}`;
    const ttlSec = Math.ceil(ttlMs / 1000);

    const result = await this.redis.set(fullKey, lockValue, 'PX', ttlMs, 'NX');
    return result === 'OK' ? lockValue : null;
  }

  async release(key: string, lockValue: string): Promise<boolean> {
    const fullKey = `${LOCK_PREFIX}${key}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, fullKey, lockValue);
    return result === 1;
  }

  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options?: { ttlMs?: number; retryDelayMs?: number },
  ): Promise<T> {
    const ttlMs = options?.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    const retryDelay = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const lockValue = await this.acquire(key, ttlMs);
      if (lockValue) {
        try {
          return await fn();
        } finally {
          await this.release(key, lockValue);
        }
      }
      await new Promise((r) => setTimeout(r, retryDelay * (attempt + 1)));
    }

    throw new Error(`Could not acquire lock for "${key}" after ${MAX_RETRY_ATTEMPTS} attempts`);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
