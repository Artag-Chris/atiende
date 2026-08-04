import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrowthAnalyticsService } from './growth-analytics.service';
import type {
  GrowthAnalyticsRepositoryPort,
  GrowthRawAnalytics,
} from '@core/ports/growth-analytics-repository.port';

function createRepo() {
  return { getAnalytics: vi.fn() } as unknown as GrowthAnalyticsRepositoryPort;
}

function makeRaw(overrides: Partial<GrowthRawAnalytics> = {}): GrowthRawAnalytics {
  return {
    conversationsTotal: 10,
    conversationsByChannel: [{ channel: 'whatsapp', count: 10 }],
    dailyUserMessages: [{ day: '2026-01-01', count: 4 }],
    messagesTotal: 25,
    userMessagesTotal: 12,
    quotesByStatus: [
      { status: 'SENT', count: 8 },
      { status: 'ACCEPTED', count: 2 },
    ],
    quotesTotal: 10,
    quoteTotalUsd: 3000,
    topServices: [{ service: 'Página web', quotes: 6, totalUsd: 1500 }],
    callRequestsTotal: 3,
    llmCostUsd: 1.25,
    llmRuns: 40,
    cacheEntries: 5,
    cacheHits: 15,
    ...overrides,
  };
}

describe('GrowthAnalyticsService', () => {
  let service: GrowthAnalyticsService;
  let repo: ReturnType<typeof createRepo>;

  beforeEach(() => {
    repo = createRepo();
    service = new GrowthAnalyticsService(repo);
  });

  it('deriva conversión, ticket promedio y cache hit rate', async () => {
    vi.mocked(repo.getAnalytics).mockResolvedValue(makeRaw());

    const metrics = await service.getMetrics('biz-1', 30);

    expect(metrics.quotesSent).toBe(8);
    expect(metrics.quotesAccepted).toBe(2);
    expect(metrics.quoteConversionRate).toBe(0.25);
    expect(metrics.averageQuoteUsd).toBe(300);
    expect(metrics.cacheHitRate).toBe(0.75);
    expect(metrics.cacheHits).toBe(15);
    expect(metrics.llmCostUsd).toBe(1.25);
  });

  it('llama al repo con la ventana [now - days, now] para el business', async () => {
    vi.mocked(repo.getAnalytics).mockResolvedValue(makeRaw());

    await service.getMetrics('biz-1', 30);

    const [, sinceArg] = vi.mocked(repo.getAnalytics).mock.calls[0];
    expect(sinceArg).toBeInstanceOf(Date);
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expected - sinceArg.getTime())).toBeLessThan(5000);
  });

  it('no divide por cero cuando no hay cotizaciones ni cache', async () => {
    vi.mocked(repo.getAnalytics).mockResolvedValue(
      makeRaw({
        quotesByStatus: [],
        quotesTotal: 0,
        quoteTotalUsd: 0,
        cacheEntries: 0,
        cacheHits: 0,
      }),
    );

    const metrics = await service.getMetrics('biz-1', 7);

    expect(metrics.quoteConversionRate).toBe(0);
    expect(metrics.averageQuoteUsd).toBe(0);
    expect(metrics.cacheHitRate).toBe(0);
  });
});
