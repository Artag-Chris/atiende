import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrowthUsageRepository } from './growth-usage.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  growthAdvisorUsage: {
    create: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    growthAdvisorUsage: {
      create: vi.fn().mockResolvedValue({}),
      aggregate: vi.fn(),
    },
  };
}

describe('GrowthUsageRepository', () => {
  let repo: GrowthUsageRepository;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new GrowthUsageRepository(prisma as unknown as PrismaService);
  });

  it('persiste una llamada del asesor con los campos mapeados', async () => {
    await repo.record({
      businessId: 'biz-1',
      model: 'llama-3.1-8b-instant',
      llmProvider: 'groq',
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0.00002,
    });

    expect(prisma.growthAdvisorUsage.create).toHaveBeenCalledWith({
      data: {
        businessId: 'biz-1',
        model: 'llama-3.1-8b-instant',
        llmProvider: 'groq',
        inputTokens: 120,
        outputTokens: 40,
        costUsd: 0.00002,
      },
    });
  });

  it('suma el costo del día calendario UTC de un business', async () => {
    prisma.growthAdvisorUsage.aggregate.mockResolvedValue({ _sum: { costUsd: 0.0042 } });

    const day = new Date('2026-01-05T12:30:00Z');
    const result = await repo.sumForDay('biz-1', day);

    expect(prisma.growthAdvisorUsage.aggregate).toHaveBeenCalledWith({
      where: {
        businessId: 'biz-1',
        createdAt: {
          gte: new Date('2026-01-05T00:00:00.000Z'),
          lt: new Date('2026-01-06T00:00:00.000Z'),
        },
      },
      _sum: { costUsd: true },
    });
    expect(result).toBe(0.0042);
  });

  it('devuelve 0 cuando no hay uso registrado', async () => {
    prisma.growthAdvisorUsage.aggregate.mockResolvedValue({ _sum: { costUsd: null } });

    const result = await repo.sumForDay('biz-1', new Date());

    expect(result).toBe(0);
  });
});
