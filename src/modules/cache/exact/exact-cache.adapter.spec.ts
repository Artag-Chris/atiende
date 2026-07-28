import { describe, it, expect, vi, beforeEach } from 'vitest';
import Redis from 'ioredis';
import type { TurnContext } from '@core/domain/types';
import type { Features } from '@config/features';
import { ExactCacheAdapter } from './exact-cache.adapter';

function createMockRedis(): Redis {
  const store = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
    scan: vi.fn(async (cursor: string | number, ...args: string[]) => {
      const matchIdx = args.indexOf('MATCH');
      const pattern = matchIdx >= 0 ? args[matchIdx + 1] : '*';
      const prefix = pattern.replace(/\*$/, '');
      const matching = [...store.keys()].filter((k) => k.startsWith(prefix));
      return ['0', matching];
    }),
  } as unknown as Redis;
}

function createFeatures(overrides?: Partial<Features>): Features {
  return {
    llm: { primary: 'groq', fallback: null },
    channels: { whatsapp: true, webChat: false, telegram: false },
    tools: { catalog: true, knowledgeSearch: true, orders: true, info: true, escalation: true },
    embeddings: { provider: 'openai' },
    ai: { promptCaching: true, compaction: false, adaptiveThinking: false, scopeGuard: false },
    cache: {
      exact: true,
      semantic: false,
      semanticMinSimilarity: 0.95,
      semanticTtlSeconds: 1800,
      exactTtlSeconds: 1800,
    },
    observability: { otel: false, sentry: false },
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<TurnContext>): TurnContext {
  return {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    customerPhone: '1234567890',
    channel: 'whatsapp',
    historyLength: 0,
    hasPersonalInfo: false,
    mayInvolveStatefulTool: false,
    businessConfig: {},
    ...overrides,
  };
}

describe('ExactCacheAdapter', () => {
  let adapter: ExactCacheAdapter;
  let redis: Redis;
  let features: Features;

  beforeEach(() => {
    redis = createMockRedis();
    features = createFeatures();
    adapter = new ExactCacheAdapter(redis, features);
  });

  describe('lookup', () => {
    it('returns null when cache feature is disabled', async () => {
      features.cache.exact = false;
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('returns null when mayInvolveStatefulTool is true', async () => {
      const result = await adapter.lookup('hola', makeCtx({ mayInvolveStatefulTool: true }));
      expect(result).toBeNull();
    });

    it('returns null when hasPersonalInfo is true', async () => {
      const result = await adapter.lookup('hola', makeCtx({ hasPersonalInfo: true }));
      expect(result).toBeNull();
    });

    it('works regardless of historyLength (safety rail removed)', async () => {
      const ctx = makeCtx({ historyLength: 2 });
      await adapter.store('hola', { responseText: 'Hola!', toolCalls: [] }, ctx);
      const result = await adapter.lookup('hola', ctx);
      expect(result).not.toBeNull();
      expect(result!.responseText).toBe('Hola!');
    });

    it('returns null on cache miss', async () => {
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('returns cached response on hit', async () => {
      const ctx = makeCtx();
      await adapter.store('hola', { responseText: 'Hola!', toolCalls: [] }, ctx);
      const result = await adapter.lookup('hola', ctx);
      expect(result).not.toBeNull();
      expect(result!.responseText).toBe('Hola!');
      expect(result!.similarity).toBe(1.0);
    });

    it('normalizes query case and whitespace', async () => {
      const ctx = makeCtx();
      await adapter.store('  HOLA  ', { responseText: 'Hola!' }, ctx);
      const result = await adapter.lookup('hola', ctx);
      expect(result).not.toBeNull();
      expect(result!.responseText).toBe('Hola!');
    });

    it('is scoped by businessId', async () => {
      await adapter.store(
        'hola',
        { responseText: 'Hola biz-1!' },
        makeCtx({ businessId: 'biz-1' }),
      );
      await adapter.store(
        'hola',
        { responseText: 'Hola biz-2!' },
        makeCtx({ businessId: 'biz-2' }),
      );
      const result = await adapter.lookup('hola', makeCtx({ businessId: 'biz-1' }));
      expect(result!.responseText).toBe('Hola biz-1!');
    });

    it('handles Redis connection error gracefully', async () => {
      const ctx = makeCtx();
      await adapter.store('hola', { responseText: 'Hola!' }, ctx);
      vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis down'));
      const result = await adapter.lookup('hola', ctx);
      expect(result).toBeNull();
    });
  });

  describe('store', () => {
    it('skips store when cache feature is disabled', async () => {
      features.cache.exact = false;
      await adapter.store('hola', { responseText: 'Hola!' }, makeCtx());
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('skips store when mayInvolveStatefulTool is true', async () => {
      await adapter.store(
        'hola',
        { responseText: 'Hola!' },
        makeCtx({ mayInvolveStatefulTool: true }),
      );
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('removes entries so lookup returns null after invalidation', async () => {
      await adapter.store('q1', { responseText: 'A1' }, makeCtx({ businessId: 'biz-1' }));
      await adapter.store('q2', { responseText: 'A2' }, makeCtx({ businessId: 'biz-1' }));
      await adapter.store('q3', { responseText: 'A3' }, makeCtx({ businessId: 'biz-2' }));

      const count = await adapter.invalidate('biz-1');
      expect(count).toBe(2);

      const r1 = await adapter.lookup('q1', makeCtx({ businessId: 'biz-1' }));
      expect(r1).toBeNull();
      const r2 = await adapter.lookup('q2', makeCtx({ businessId: 'biz-1' }));
      expect(r2).toBeNull();

      const r3 = await adapter.lookup('q3', makeCtx({ businessId: 'biz-2' }));
      expect(r3).not.toBeNull();
    });

    it('returns 0 when no entries', async () => {
      const count = await adapter.invalidate('biz-none');
      expect(count).toBe(0);
    });

    it('does not affect entries of other businesses', async () => {
      await adapter.store('q', { responseText: 'A' }, makeCtx({ businessId: 'biz-1' }));
      await adapter.store('q', { responseText: 'B' }, makeCtx({ businessId: 'biz-2' }));
      await adapter.invalidate('biz-1');

      const r2 = await adapter.lookup('q', makeCtx({ businessId: 'biz-2' }));
      expect(r2).not.toBeNull();
      expect(r2!.responseText).toBe('B');
    });
  });
});
