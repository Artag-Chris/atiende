import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TurnContext } from '@core/domain/types';
import type { Features } from '@config/features';
import { PgvectorSemanticCacheAdapter } from './pgvector-semantic-cache.adapter';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';

function createFeatures(overrides?: Partial<Features>): Features {
  return {
    llm: { primary: 'groq', fallback: null },
    channels: { whatsapp: true, webChat: false, telegram: false },
    tools: { catalog: true, knowledgeSearch: true, orders: true, info: true, escalation: true },
    embeddings: { provider: 'openai' },
    ai: { promptCaching: true, compaction: false, adaptiveThinking: false, scopeGuard: false },
    cache: {
      exact: true,
      semantic: true,
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

const fixedEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536);

describe('PgvectorSemanticCacheAdapter', () => {
  let adapter: PgvectorSemanticCacheAdapter;
  let prisma: {
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let embedder: EmbeddingProviderPort;
  let features: Features;

  beforeEach(() => {
    prisma = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    embedder = {
      name: 'test-embedder',
      embed: vi.fn().mockResolvedValue([fixedEmbedding]),
      dimension: () => 1536,
    };
    features = createFeatures();
    adapter = new PgvectorSemanticCacheAdapter(prisma as never, embedder, features);
  });

  describe('lookup', () => {
    it('returns null when semantic cache feature is disabled', async () => {
      features.cache.semantic = false;
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
      expect(embedder.embed).not.toHaveBeenCalled();
    });

    it('returns null when mayInvolveStatefulTool is true', async () => {
      const result = await adapter.lookup('hola', makeCtx({ mayInvolveStatefulTool: true }));
      expect(result).toBeNull();
    });

    it('returns null when hasPersonalInfo is true', async () => {
      const result = await adapter.lookup('hola', makeCtx({ hasPersonalInfo: true }));
      expect(result).toBeNull();
    });

    it('returns null on cache miss', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('returns cached response on hit', async () => {
      const cachedAt = new Date();
      const row = {
        id: 'row-1',
        response_text: 'Hola!',
        tool_calls: '[]',
        cached_at: cachedAt,
        similarity: 0.97,
      };
      prisma.$queryRaw.mockResolvedValue([row]);

      const result = await adapter.lookup('hola', makeCtx());

      expect(result).not.toBeNull();
      expect(result!.responseText).toBe('Hola!');
      expect(result!.similarity).toBe(0.97);
      expect(result!.cachedAt).toEqual(cachedAt);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('embeds the query text', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await adapter.lookup('Hola mundo', makeCtx());
      expect(embedder.embed).toHaveBeenCalledWith(['Hola mundo']);
    });

    it('handles embedding error gracefully', async () => {
      embedder.embed = vi.fn().mockRejectedValue(new Error('Embedding API down'));
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('handles DB query error gracefully', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('DB connection error'));
      const result = await adapter.lookup('hola', makeCtx());
      expect(result).toBeNull();
    });

    it('increments hit_count on cache hit', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'row-1',
          response_text: 'Hola!',
          tool_calls: '[]',
          cached_at: new Date(),
          similarity: 0.97,
        },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      await adapter.lookup('hola', makeCtx());

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('does not fail if hit_count update fails', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'row-1',
          response_text: 'Hola!',
          tool_calls: '[]',
          cached_at: new Date(),
          similarity: 0.97,
        },
      ]);
      prisma.$executeRaw.mockRejectedValue(new Error('Update failed'));

      const result = await adapter.lookup('hola', makeCtx());
      expect(result).not.toBeNull();
      expect(result!.responseText).toBe('Hola!');
    });

    it('is scoped by businessId', async () => {
      embedder.embed = vi.fn().mockResolvedValue([fixedEmbedding]);
      prisma.$queryRaw.mockResolvedValue([]);

      await adapter.lookup('hola', makeCtx({ businessId: 'biz-1' }));
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe('store', () => {
    it('skips store when semantic cache feature is disabled', async () => {
      features.cache.semantic = false;
      await adapter.store('hola', { responseText: 'Hola!', toolCalls: [] }, makeCtx());
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('skips store when mayInvolveStatefulTool is true', async () => {
      await adapter.store(
        'hola',
        { responseText: 'Hola!' },
        makeCtx({ mayInvolveStatefulTool: true }),
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('embeds and stores the response', async () => {
      prisma.$executeRaw.mockResolvedValue(1);

      await adapter.store(
        'Hola mundo',
        { responseText: 'Hola!', toolCalls: [{ name: 'test', input: {} }] },
        makeCtx(),
      );

      expect(embedder.embed).toHaveBeenCalledWith(['Hola mundo']);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('handles embedding error gracefully', async () => {
      embedder.embed = vi.fn().mockRejectedValue(new Error('Embedding API down'));
      await expect(
        adapter.store('hola', { responseText: 'Hola!', toolCalls: [] }, makeCtx()),
      ).resolves.toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('deletes entries for the business', async () => {
      prisma.$executeRaw.mockResolvedValue(3);
      const count = await adapter.invalidate('biz-1');
      expect(count).toBe(3);
    });

    it('returns 0 on error', async () => {
      prisma.$executeRaw.mockRejectedValue(new Error('DB error'));
      const count = await adapter.invalidate('biz-1');
      expect(count).toBe(0);
    });
  });
});
