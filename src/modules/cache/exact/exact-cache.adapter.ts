import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import type { ResponseCachePort, CacheHit, CacheableResponse } from '@core/ports/response-cache.port';
import type { TurnContext } from '@core/domain/types';
import { REDIS_CLIENT_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { Features } from '@config/features';

@Injectable()
export class ExactCacheAdapter implements ResponseCachePort {
  readonly name = 'exact';
  private readonly logger = new Logger(ExactCacheAdapter.name);
  private readonly prefix = 'cache:exact:';

  constructor(
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(FEATURES_TOKEN) private readonly features: Features,
  ) {}

  private buildKey(businessId: string, query: string): string {
    const normalized = query.toLowerCase().trim();
    const hash = createHash('sha256').update(normalized).digest('hex');
    return `${this.prefix}${businessId}:${hash}`;
  }

  private keysSetKey(businessId: string): string {
    return `${this.prefix}keys:${businessId}`;
  }

  private isCacheable(ctx: TurnContext): boolean {
    if (!this.features.cache.exact) return false;
    if (ctx.mayInvolveStatefulTool) return false;
    if (ctx.hasPersonalInfo) return false;
    return true;
  }

  async lookup(query: string, ctx: TurnContext): Promise<CacheHit | null> {
    if (!this.isCacheable(ctx)) return null;

    const key = this.buildKey(ctx.businessId, query);
    const raw = await this.redis.get(key).catch(() => null);
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

    await this.redis
      .pipeline()
      .setex(key, this.features.cache.exactTtlSeconds, payload)
      .sadd(this.keysSetKey(ctx.businessId), key)
      .exec()
      .catch((err: Error) => {
        this.logger.warn(`Failed to store cache: ${err.message}`);
      });
    this.logger.debug(`Exact cache STORE for business=${ctx.businessId}`);
  }

  async invalidate(businessId: string): Promise<number> {
    const setKey = this.keysSetKey(businessId);
    const members = await this.redis.smembers(setKey).catch(() => [] as string[]);
    if (members.length === 0) return 0;

    await this.redis
      .pipeline()
      .del(...members)
      .del(setKey)
      .exec()
      .catch((err: Error) => {
        this.logger.warn(`Failed to invalidate cache: ${err.message}`);
      });

    this.logger.log(`Invalidated ${members.length} exact cache entries for business=${businessId}`);
    return members.length;
  }
}
