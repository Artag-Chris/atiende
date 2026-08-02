import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import { toDomainChannel, toPrismaChannel } from './channel.mapper';
import type { QuoteData, QuoteInput, QuoteRepositoryPort } from '@core/ports/quote-repository.port';
import type { Channel } from '@core/domain/types';

@Injectable()
export class QuoteRepository implements QuoteRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async save(input: QuoteInput): Promise<QuoteData> {
    // Idempotencia: si la misma petición ya generó una quote (mismo dedupKey),
    // devolvemos la existente sin duplicar.
    const existing = await this.prisma.quote.findUnique({
      where: { dedupKey: input.dedupKey },
    });
    if (existing) return this.toDomain(existing);

    const row = await this.prisma.quote.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        customerIdentifier: input.customerIdentifier,
        channel: toPrismaChannel(input.channel),
        services: input.services as never,
        infrastructure: input.infrastructure as never,
        breakdown: input.breakdown as never,
        totalUsd: input.totalUsd,
        totalDisplay: input.totalDisplay,
        currency: input.currency,
        rateUsed: input.rateUsed,
        dedupKey: input.dedupKey,
      },
    });
    return this.toDomain(row);
  }

  async findLatestForCustomer(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<QuoteData | null> {
    const row = await this.prisma.quote.findFirst({
      where: {
        businessId,
        channel: toPrismaChannel(channel),
        customerIdentifier,
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByIdForCustomer(
    id: string,
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<QuoteData | null> {
    const row = await this.prisma.quote.findFirst({
      where: {
        id,
        businessId,
        channel: toPrismaChannel(channel),
        customerIdentifier,
      },
    });
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: {
    id: string;
    businessId: string;
    conversationId: string;
    customerIdentifier: string;
    channel: unknown;
    services: unknown;
    infrastructure: unknown;
    breakdown: unknown;
    totalUsd: unknown;
    totalDisplay: string;
    currency: string;
    rateUsed: unknown;
    dedupKey: string;
    status: unknown;
    notes: unknown;
    createdAt: Date;
  }): QuoteData {
    return {
      id: row.id,
      businessId: row.businessId,
      conversationId: row.conversationId,
      customerIdentifier: row.customerIdentifier,
      channel: toDomainChannel(row.channel as never),
      services: (row.services ?? []) as Array<Record<string, unknown>>,
      infrastructure: (row.infrastructure ?? {}) as Record<string, unknown>,
      breakdown: (row.breakdown ?? {}) as Record<string, unknown>,
      totalUsd: Number(row.totalUsd),
      totalDisplay: row.totalDisplay,
      currency: row.currency,
      rateUsed: row.rateUsed === null || row.rateUsed === undefined ? null : Number(row.rateUsed),
      dedupKey: row.dedupKey,
      status: String(row.status),
      notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
      createdAt: row.createdAt,
    };
  }
}
