import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type {
  ExchangeRateData,
  ExchangeRateRepositoryPort,
} from '@core/ports/exchange-rate-repository.port';

@Injectable()
export class ExchangeRateRepository implements ExchangeRateRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async upsert(pair: string, rate: number, source: string): Promise<ExchangeRateData> {
    const row = await this.prisma.exchangeRate.upsert({
      where: { pair },
      update: { rate, source, fetchedAt: new Date() },
      create: { pair, rate, source },
    });
    return this.toDomain(row);
  }

  async findByPair(pair: string): Promise<ExchangeRateData | null> {
    const row = await this.prisma.exchangeRate.findUnique({ where: { pair } });
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: {
    id: string;
    pair: string;
    rate: unknown;
    source: string;
    fetchedAt: Date;
  }): ExchangeRateData {
    return {
      id: row.id,
      pair: row.pair,
      rate: Number(row.rate),
      source: row.source,
      fetchedAt: row.fetchedAt,
    };
  }
}
