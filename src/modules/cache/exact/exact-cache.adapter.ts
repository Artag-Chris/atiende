import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import type {
  ResponseCachePort,
  CacheHit,
  CacheableResponse,
} from '@core/ports/response-cache.port';
import type { TurnContext } from '@core/domain/types';
import { REDIS_CLIENT_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { Features } from '@config/features';

const FALLBACK_TTL_MS = 1800_000;

@Injectable()
export class ExactCacheAdapter implements ResponseCachePort {
  readonly name = 'exact';
  private readonly logger = new Logger(ExactCacheAdapter.name);
  private readonly prefix = 'cache:exact:';

  private readonly fallback = new Map<string, { payload: string; expiresAt: number }>();

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(FEATURES_TOKEN) private readonly features: Features,
  ) {}

  private buildKey(businessId: string, query: string): string {
    const normalized = query.toLowerCase().trim();
    const hash = createHash('sha256').update(normalized).digest('hex');
    return `${this.prefix}${businessId}:${hash}`;
  }

  private scanPattern(businessId: string): string {
    return `${this.prefix}${businessId}:*`;
  }

  private isCacheable(ctx: TurnContext): boolean {
    if (!this.features.cache.exact) return false;
    if (ctx.mayInvolveStatefulTool) return false;
    if (ctx.hasPersonalInfo) return false;
    return true;
  }

  private readFallback(key: string): string | null {
    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.fallback.delete(key);
      return null;
    }
    return entry.payload;
  }

  private writeFallback(key: string, payload: string): void {
    this.fallback.set(key, { payload, expiresAt: Date.now() + FALLBACK_TTL_MS });
  }

  private deleteFallback(keys: string[]): number {
    let count = 0;
    for (const k of keys) {
      if (this.fallback.delete(k)) count++;
    }
    return count;
  }

  private fallbackKeys(pattern: string): string[] {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.fallback.keys()].filter((k) => k.startsWith(prefix));
  }

  async lookup(query: string, ctx: TurnContext): Promise<CacheHit | null> {
    if (!this.isCacheable(ctx)) return null;

    const key = this.buildKey(ctx.businessId, query);
    const raw = await this.redis.get(key).catch(() => this.readFallback(key));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      this.logger.debug(`Exact cache HIT for business=${ctx.businessId}`);
      return {
        responseText: parsed.responseText,
        similarity: 1.0,
        cachedAt: new Date(parsed.cachedAt),
      };
    } catch {
      this.logger.warn(`Corrupt cached value for key=${key}`);
      return null;
    }
  }

  async store(query: string, response: CacheableResponse, ctx: TurnContext): Promise<void> {
    if (!this.isCacheable(ctx)) return;

    const key = this.buildKey(ctx.businessId, query);
    const payload = JSON.stringify({
      responseText: response.responseText,
      toolCalls: response.toolCalls,
      cachedAt: new Date().toISOString(),
    });

    const stored = await this.redis
      .setex(key, this.features.cache.exactTtlSeconds, payload)
      .then(() => true)
      .catch((err: Error) => {
        this.logger.warn(`Redis store failed, using in-memory fallback: ${err.message}`);
        this.writeFallback(key, payload);
        return false;
      });
    this.logger.debug(
      `Exact cache STORE${stored ? '' : ' (in-memory fallback)'} for business=${ctx.businessId}`,
    );
  }

  async invalidate(businessId: string): Promise<number> {
    const pattern = this.scanPattern(businessId);

    let redisCount = 0;
    try {
      const keysToDelete: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        keysToDelete.push(...keys);
      } while (cursor !== '0');

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
        redisCount = keysToDelete.length;
      }
    } catch (err) {
      this.logger.warn(`Failed to scan Redis cache keys: ${err}`);
    }

    const fallbackKeys = this.fallbackKeys(pattern);
    const fallbackCount = this.deleteFallback(fallbackKeys);
    const total = redisCount + fallbackCount;

    if (total > 0) {
      this.logger.log(
        `Invalidated ${total} exact cache entries for business=${businessId}${redisCount > 0 && fallbackCount > 0 ? ` (${redisCount} redis, ${fallbackCount} fallback)` : ''}`,
      );
    }
    return total;
  }
}
