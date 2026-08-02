import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type {
  CloudPricingData,
  CloudPricingInput,
  CloudPricingRepositoryPort,
} from '@core/ports/cloud-pricing-repository.port';

@Injectable()
export class CloudPricingRepository implements CloudPricingRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async upsert(input: CloudPricingInput): Promise<CloudPricingData> {
    const row = await this.prisma.cloudPricing.upsert({
      where: {
        provider_service_region: {
          provider: input.provider,
          service: input.service,
          region: input.region,
        },
      },
      update: {
        priceUsd: input.priceUsd,
        unit: input.unit,
        metadata: (input.metadata ?? {}) as never,
        source: input.source ?? 'manual',
        fetchedAt: new Date(),
      },
      create: {
        provider: input.provider,
        service: input.service,
        region: input.region,
        priceUsd: input.priceUsd,
        unit: input.unit,
        metadata: (input.metadata ?? {}) as never,
        source: input.source ?? 'manual',
      },
    });
    return this.toDomain(row);
  }

  async findByProviderService(
    provider: string,
    service: string,
    region?: string,
  ): Promise<CloudPricingData | null> {
    const row = await this.prisma.cloudPricing.findFirst({
      where: {
        provider,
        service,
        region: region ?? 'global',
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async listByProvider(provider: string): Promise<CloudPricingData[]> {
    const rows = await this.prisma.cloudPricing.findMany({
      where: { provider },
      orderBy: { service: 'asc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  private toDomain(row: {
    id: string;
    provider: string;
    service: string;
    region: string;
    priceUsd: unknown;
    unit: string;
    metadata: unknown;
    source: string;
    fetchedAt: Date;
  }): CloudPricingData {
    return {
      id: row.id,
      provider: row.provider,
      service: row.service,
      region: row.region,
      priceUsd: Number(row.priceUsd),
      unit: row.unit,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      source: row.source,
      fetchedAt: row.fetchedAt,
    };
  }
}
