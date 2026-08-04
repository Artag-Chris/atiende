import { Inject, Injectable } from '@nestjs/common';
import { GROWTH_ANALYTICS_REPOSITORY_TOKEN } from '@core/tokens';
import type {
  GrowthAnalyticsRepositoryPort,
  GrowthMetrics,
} from '@core/ports/growth-analytics-repository.port';

/**
 * Calcula los KPIs de growth a partir de las agregaciones crudas del
 * repositorio. Sin LLM: sirve al endpoint /metrics y alimenta el prompt del
 * asesor.
 */
@Injectable()
export class GrowthAnalyticsService {
  constructor(
    @Inject(GROWTH_ANALYTICS_REPOSITORY_TOKEN)
    private readonly repo: GrowthAnalyticsRepositoryPort,
  ) {}

  async getMetrics(businessId: string, windowDays: number): Promise<GrowthMetrics> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const raw = await this.repo.getAnalytics(businessId, since);

    const quotesSent = raw.quotesByStatus.find((q) => q.status === 'SENT')?.count ?? 0;
    const quotesAccepted = raw.quotesByStatus.find((q) => q.status === 'ACCEPTED')?.count ?? 0;
    const quoteConversionRate = quotesSent > 0 ? quotesAccepted / quotesSent : 0;
    const averageQuoteUsd = raw.quotesTotal > 0 ? raw.quoteTotalUsd / raw.quotesTotal : 0;
    const cacheHitRate =
      raw.cacheHits + raw.cacheEntries > 0 ? raw.cacheHits / (raw.cacheHits + raw.cacheEntries) : 0;

    return {
      windowDays,
      since: since.toISOString(),
      conversationsTotal: raw.conversationsTotal,
      conversationsByChannel: raw.conversationsByChannel,
      dailyUserMessages: raw.dailyUserMessages,
      messagesTotal: raw.messagesTotal,
      userMessagesTotal: raw.userMessagesTotal,
      quotesTotal: raw.quotesTotal,
      quotesSent,
      quotesAccepted,
      quoteConversionRate: round(quoteConversionRate, 4),
      averageQuoteUsd: round(averageQuoteUsd, 2),
      topServices: raw.topServices,
      callRequestsTotal: raw.callRequestsTotal,
      llmCostUsd: raw.llmCostUsd,
      llmRuns: raw.llmRuns,
      cacheHitRate: round(cacheHitRate, 4),
      cacheEntries: raw.cacheEntries,
      cacheHits: raw.cacheHits,
    };
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
