import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type {
  GrowthAdvisorUsageRepositoryPort,
  GrowthUsageRecordInput,
} from '@core/ports/growth-advisor-usage-repository.port';

/**
 * Auditoría del asesor de growth: una fila por llamada al LLM de analytics.
 * Alimenta el presupuesto diario por business (GROWTH_ADVISOR_BUDGET_USD_DAY)
 * y futuras vistas de costos del asesor.
 */
@Injectable()
export class GrowthUsageRepository implements GrowthAdvisorUsageRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async record(input: GrowthUsageRecordInput): Promise<void> {
    await this.prisma.growthAdvisorUsage.create({
      data: {
        businessId: input.businessId,
        model: input.model,
        llmProvider: input.llmProvider,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
      },
    });
  }

  async sumForDay(businessId: string, day: Date): Promise<number> {
    const start = startOfUtcDay(day);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const result = await this.prisma.growthAdvisorUsage.aggregate({
      where: {
        businessId,
        createdAt: { gte: start, lt: end },
      },
      _sum: { costUsd: true },
    });
    return Number(result._sum.costUsd ?? 0);
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
