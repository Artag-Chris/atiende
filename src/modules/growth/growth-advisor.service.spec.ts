import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { GrowthAdvisorService } from './growth-advisor.service';
import { GrowthAnalyticsService } from './growth-analytics.service';
import type { LLMProviderPort } from '@core/ports/llm-provider.port';
import type { GrowthAdvisorUsageRepositoryPort } from '@core/ports/growth-advisor-usage-repository.port';
import type { AIConfig } from '@config/ai.config';
import type { GrowthMetrics } from '@core/ports/growth-analytics-repository.port';

function createLlm() {
  return {
    name: 'groq',
    chat: vi.fn().mockResolvedValue({
      text: 'Análisis y próximos pasos...',
      toolCalls: [],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 500,
        outputTokens: 120,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      costUsd: 0.0004,
      model: 'llama-3.1-8b-instant',
    }),
    isHealthy: vi.fn().mockResolvedValue(true),
  } as unknown as LLMProviderPort;
}

function createAnalytics() {
  return {
    getMetrics: vi.fn().mockResolvedValue({
      windowDays: 30,
    } as unknown as GrowthMetrics),
  } as unknown as GrowthAnalyticsService;
}

function createUsageRepo() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
    sumForDay: vi.fn().mockResolvedValue(0),
  } as unknown as GrowthAdvisorUsageRepositoryPort;
}

function makeAiConfig(): AIConfig {
  return {
    analytics: {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      effort: 'medium',
      maxTokens: 2048,
      timeoutMs: 30000,
      maxRetries: 2,
    },
  } as unknown as AIConfig;
}

function makeConfigService(budget?: number | null) {
  return {
    get: vi.fn((key: string) => (key === 'GROWTH_ADVISOR_BUDGET_USD_DAY' ? budget : undefined)),
  } as unknown as ConfigService;
}

describe('GrowthAdvisorService', () => {
  let service: GrowthAdvisorService;
  let llm: ReturnType<typeof createLlm>;
  let analytics: ReturnType<typeof createAnalytics>;
  let usageRepo: ReturnType<typeof createUsageRepo>;
  let configService: ReturnType<typeof makeConfigService>;

  beforeEach(() => {
    llm = createLlm();
    analytics = createAnalytics();
    usageRepo = createUsageRepo();
    configService = makeConfigService(1.0);
    service = new GrowthAdvisorService(llm, analytics, usageRepo, makeAiConfig(), configService);
  });

  it('llama al LLM de analytics, registra el uso y devuelve la respuesta', async () => {
    const result = await service.ask('biz-1', '¿Qué debo mejorar?', 30);

    expect(analytics.getMetrics).toHaveBeenCalledWith('biz-1', 30);
    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 2048,
        systemPrompt: expect.stringContaining('asesor de growth'),
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: expect.stringContaining('¿Qué debo mejorar?') }],
          },
        ],
      }),
    );
    expect(usageRepo.record).toHaveBeenCalledWith({
      businessId: 'biz-1',
      model: 'llama-3.1-8b-instant',
      llmProvider: 'groq',
      inputTokens: 500,
      outputTokens: 120,
      costUsd: 0.0004,
    });
    expect(result.answer).toContain('Análisis');
    expect(result.costUsd).toBe(0.0004);
    expect(result.budgetExceeded).toBe(false);
    expect(result.budgetUsd).toBe(1.0);
  });

  it('no llama al LLM cuando el presupuesto diario está agotado', async () => {
    usageRepo.sumForDay = vi.fn().mockResolvedValue(1.0);

    const result = await service.ask('biz-1', '¿Qué debo mejorar?', 30);

    expect(llm.chat).not.toHaveBeenCalled();
    expect(usageRepo.record).not.toHaveBeenCalled();
    expect(result.budgetExceeded).toBe(true);
    expect(result.costUsd).toBe(0);
    expect(result.answer).toContain('presupuesto diario');
  });

  it('presupuesto 0 = sin límite', async () => {
    configService = makeConfigService(0);
    service = new GrowthAdvisorService(llm, analytics, usageRepo, makeAiConfig(), configService);
    usageRepo.sumForDay = vi.fn().mockResolvedValue(10);

    const result = await service.ask('biz-1', 'pregunta', 30);

    expect(llm.chat).toHaveBeenCalled();
    expect(result.budgetExceeded).toBe(false);
    expect(result.budgetUsd).toBe(0);
  });

  it('usa el default de presupuesto cuando no está configurado', async () => {
    configService = makeConfigService(null);
    service = new GrowthAdvisorService(llm, analytics, usageRepo, makeAiConfig(), configService);
    usageRepo.sumForDay = vi.fn().mockResolvedValue(0.99);

    const result = await service.ask('biz-1', 'pregunta', 30);

    expect(result.budgetUsd).toBe(1.0);
    expect(llm.chat).toHaveBeenCalled();
  });
});
