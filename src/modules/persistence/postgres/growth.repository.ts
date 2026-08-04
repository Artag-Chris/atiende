import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaDbClient, PrismaService } from './prisma.service';
import { toDomainChannel } from './channel.mapper';
import type {
  GrowthAnalyticsRepositoryPort,
  GrowthRawAnalytics,
} from '@core/ports/growth-analytics-repository.port';

interface DailyUserMessageRow {
  day: Date;
  count: number;
}

interface CountRow {
  count: number;
}

interface TopServiceRow {
  service: string;
  quotes: number;
  totalUsd: number;
}

/**
 * Agregaciones del asesor de growth. Todo tenant-scoped por businessId y
 * resuelto EN SQL (sin arrastrar filas a memoria): Message.businessId está
 * denormalizado (igual que AgentRun) y Quote agrega con groupBy/aggregate +
 * jsonb_array_elements para top services.
 */
@Injectable()
export class GrowthAnalyticsRepository implements GrowthAnalyticsRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async getAnalytics(businessId: string, since: Date): Promise<GrowthRawAnalytics> {
    const [
      conversationGroup,
      dailyRows,
      quotesGroup,
      quotesAgg,
      topServices,
      callRequestsTotal,
      agentRuns,
      cache,
    ] = await Promise.all([
      this.prisma.conversation.groupBy({
        by: ['channel'],
        where: { businessId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.fetchDailyUserMessages(businessId, since),
      this.prisma.quote.groupBy({
        by: ['status'],
        where: { businessId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.quote.aggregate({
        where: { businessId, createdAt: { gte: since } },
        _sum: { totalUsd: true },
        _count: true,
      }),
      this.fetchTopServices(businessId, since),
      this.prisma.callRequest.count({
        where: { businessId, createdAt: { gte: since } },
      }),
      this.prisma.agentRun.aggregate({
        where: { businessId, createdAt: { gte: since } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.responseCache.aggregate({
        where: { businessId, lastUsedAt: { gte: since } },
        _sum: { hitCount: true },
        _count: true,
      }),
    ]);

    const userMessagesTotal = dailyRows.reduce((acc, row) => acc + row.count, 0);
    const messagesTotal = await this.countMessages(businessId, since);

    return {
      conversationsTotal: conversationGroup.reduce((acc, g) => acc + g._count._all, 0),
      conversationsByChannel: conversationGroup.map((g) => ({
        channel: toDomainChannel(g.channel),
        count: g._count._all,
      })),
      dailyUserMessages: dailyRows.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        count: row.count,
      })),
      messagesTotal,
      userMessagesTotal,
      quotesByStatus: quotesGroup.map((g) => ({ status: g.status, count: g._count._all })),
      quotesTotal: quotesAgg._count,
      quoteTotalUsd: Number(quotesAgg._sum.totalUsd ?? 0),
      topServices,
      callRequestsTotal,
      llmCostUsd: Number(agentRuns._sum.costUsd ?? 0),
      llmRuns: agentRuns._count,
      cacheEntries: cache._count,
      cacheHits: Number(cache._sum.hitCount ?? 0),
    };
  }

  private async fetchDailyUserMessages(
    businessId: string,
    since: Date,
  ): Promise<DailyUserMessageRow[]> {
    return this.prisma.$queryRaw<DailyUserMessageRow[]>(Prisma.sql`
      SELECT date_trunc('day', m."created_at")::date AS day, COUNT(*)::int AS count
      FROM messages m
      WHERE m."business_id" = ${businessId}::uuid
        AND m."role" = 'USER'
        AND m."created_at" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
  }

  private async countMessages(businessId: string, since: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM messages m
      WHERE m."business_id" = ${businessId}::uuid
        AND m."created_at" >= ${since}
    `);
    return rows[0]?.count ?? 0;
  }

  /**
   * Top 10 servicios cotizados, agregado EN SQL sobre services_jsonb
   * (array de { slug, name, priceUsd }). Agrega por name (fallback slug).
   */
  private async fetchTopServices(
    businessId: string,
    since: Date,
  ): Promise<Array<{ service: string; quotes: number; totalUsd: number }>> {
    const rows = await this.prisma.$queryRaw<TopServiceRow[]>(Prisma.sql`
      SELECT
        COALESCE(NULLIF(elem ->> 'name', ''), elem ->> 'slug') AS service,
        COUNT(*)::int AS quotes,
        COALESCE(SUM((elem ->> 'priceUsd')::numeric), 0)::float AS total_usd
      FROM quotes q
      CROSS JOIN LATERAL jsonb_array_elements(q."services_jsonb") AS elem
      WHERE q."business_id" = ${businessId}::uuid
        AND q."created_at" >= ${since}
        AND jsonb_typeof(q."services_jsonb") = 'array'
        AND (elem ->> 'name') IS NOT NULL
      GROUP BY 1
      ORDER BY quotes DESC, total_usd DESC
      LIMIT 10
    `);
    return rows.map((row) => ({
      service: row.service,
      quotes: row.quotes,
      totalUsd: row.totalUsd,
    }));
  }
}
