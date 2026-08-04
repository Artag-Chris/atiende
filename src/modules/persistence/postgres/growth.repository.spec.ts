import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrowthAnalyticsRepository } from './growth.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  conversation: { groupBy: ReturnType<typeof vi.fn> };
  quote: { groupBy: ReturnType<typeof vi.fn>; aggregate: ReturnType<typeof vi.fn> };
  callRequest: { count: ReturnType<typeof vi.fn> };
  agentRun: { aggregate: ReturnType<typeof vi.fn> };
  responseCache: { aggregate: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function createMockPrisma(): MockPrisma {
  return {
    conversation: { groupBy: vi.fn() },
    quote: { groupBy: vi.fn(), aggregate: vi.fn() },
    callRequest: { count: vi.fn() },
    agentRun: { aggregate: vi.fn() },
    responseCache: { aggregate: vi.fn() },
    $queryRaw: vi.fn(),
  };
}

describe('GrowthAnalyticsRepository', () => {
  let repo: GrowthAnalyticsRepository;
  let prisma: MockPrisma;
  const since = new Date('2026-01-01T00:00:00Z');

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new GrowthAnalyticsRepository(prisma as unknown as PrismaService);
  });

  it('agrega KPIs tenant-scoped con groupBy/aggregate y top services en SQL', async () => {
    prisma.conversation.groupBy.mockResolvedValue([
      { channel: 'WHATSAPP', _count: { _all: 3 } },
      { channel: 'INSTAGRAM', _count: { _all: 1 } },
    ]);
    prisma.$queryRaw
      .mockResolvedValueOnce([{ day: new Date('2026-01-01T00:00:00Z'), count: 2 }])
      .mockResolvedValueOnce([
        { service: 'Página web', quotes: 2, totalUsd: 500 },
        { service: 'Chatbot', quotes: 1, totalUsd: 300 },
      ])
      .mockResolvedValueOnce([{ count: 5 }]);
    prisma.quote.groupBy.mockResolvedValue([
      { status: 'SENT', _count: { _all: 1 } },
      { status: 'ACCEPTED', _count: { _all: 1 } },
    ]);
    prisma.quote.aggregate.mockResolvedValue({ _sum: { totalUsd: 800 }, _count: 2 });
    prisma.callRequest.count.mockResolvedValue(2);
    prisma.agentRun.aggregate.mockResolvedValue({ _sum: { costUsd: 0.5 }, _count: 3 });
    prisma.responseCache.aggregate.mockResolvedValue({ _sum: { hitCount: 4 }, _count: 2 });

    const result = await repo.getAnalytics('biz-1', since);

    expect(prisma.conversation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['channel'],
        where: { businessId: 'biz-1', createdAt: { gte: since } },
      }),
    );
    expect(prisma.quote.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: { businessId: 'biz-1', createdAt: { gte: since } },
      }),
    );
    expect(prisma.quote.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', createdAt: { gte: since } },
        _sum: { totalUsd: true },
      }),
    );
    expect(result.conversationsTotal).toBe(4);
    expect(result.conversationsByChannel).toEqual([
      { channel: 'whatsapp', count: 3 },
      { channel: 'instagram', count: 1 },
    ]);
    expect(result.dailyUserMessages).toEqual([{ day: '2026-01-01', count: 2 }]);
    expect(result.userMessagesTotal).toBe(2);
    expect(result.messagesTotal).toBe(5);
    expect(result.quotesTotal).toBe(2);
    expect(result.quoteTotalUsd).toBe(800);
    expect(result.quotesByStatus).toEqual([
      { status: 'SENT', count: 1 },
      { status: 'ACCEPTED', count: 1 },
    ]);
    expect(result.topServices).toEqual([
      { service: 'Página web', quotes: 2, totalUsd: 500 },
      { service: 'Chatbot', quotes: 1, totalUsd: 300 },
    ]);
    expect(result.callRequestsTotal).toBe(2);
    expect(result.llmCostUsd).toBe(0.5);
    expect(result.llmRuns).toBe(3);
    expect(result.cacheHits).toBe(4);
    expect(result.cacheEntries).toBe(2);
  });

  it('tolera ventanas sin datos (sin divisiones ni filas fantasma)', async () => {
    prisma.conversation.groupBy.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 0 }]);
    prisma.quote.groupBy.mockResolvedValue([]);
    prisma.quote.aggregate.mockResolvedValue({ _sum: { totalUsd: null }, _count: 0 });
    prisma.callRequest.count.mockResolvedValue(0);
    prisma.agentRun.aggregate.mockResolvedValue({ _sum: { costUsd: null }, _count: 0 });
    prisma.responseCache.aggregate.mockResolvedValue({ _sum: { hitCount: null }, _count: 0 });

    const result = await repo.getAnalytics('biz-1', since);

    expect(result.conversationsTotal).toBe(0);
    expect(result.topServices).toEqual([]);
    expect(result.quotesByStatus).toEqual([]);
    expect(result.quotesTotal).toBe(0);
    expect(result.quoteTotalUsd).toBe(0);
    expect(result.llmCostUsd).toBe(0);
    expect(result.llmRuns).toBe(0);
  });

  it('usa Message.businessId denormalizado (sin JOIN) y agrega top services en SQL', async () => {
    prisma.conversation.groupBy.mockResolvedValue([]);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }]);
    prisma.quote.groupBy.mockResolvedValue([]);
    prisma.quote.aggregate.mockResolvedValue({ _sum: { totalUsd: null }, _count: 0 });
    prisma.callRequest.count.mockResolvedValue(0);
    prisma.agentRun.aggregate.mockResolvedValue({ _sum: { costUsd: 0 }, _count: 0 });
    prisma.responseCache.aggregate.mockResolvedValue({ _sum: { hitCount: 0 }, _count: 0 });

    await repo.getAnalytics('biz-1', since);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    const dailySql = (
      vi.mocked(prisma.$queryRaw).mock.calls[0][0] as { strings?: string[] }
    ).strings!.join('');
    expect(dailySql).toContain('FROM messages m');
    expect(dailySql).toContain('m."business_id"');
    expect(dailySql).toContain('m."role" = \'USER\'');
    expect(dailySql).not.toContain('JOIN conversations');

    const topServicesSql = (
      vi.mocked(prisma.$queryRaw).mock.calls[1][0] as { strings?: string[] }
    ).strings!.join('');
    expect(topServicesSql).toContain('jsonb_array_elements');
    expect(topServicesSql).toContain('services_jsonb');
    expect(topServicesSql).toContain('business_id');
  });
});
