import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { EstimatePriceTool } from './estimate-price.tool';
import type { CloudPricingRepositoryPort } from '@core/ports/cloud-pricing-repository.port';
import type { ExchangeRateRepositoryPort } from '@core/ports/exchange-rate-repository.port';
import type { QuoteRepositoryPort } from '@core/ports/quote-repository.port';
import type { ProductRepository } from '@modules/persistence/postgres/product.repository';
import type { TurnContext } from '@core/domain/types';

function makeCtx(overrides?: Partial<TurnContext>): TurnContext {
  return {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    customerPhone: '573001234567',
    channel: 'whatsapp',
    historyLength: 2,
    hasPersonalInfo: false,
    mayInvolveStatefulTool: false,
    businessConfig: {},
    ...overrides,
  };
}

function createTool(overrides?: {
  cloudPricing?: Partial<CloudPricingRepositoryPort>;
  exchangeRate?: Partial<ExchangeRateRepositoryPort>;
  quote?: Partial<QuoteRepositoryPort>;
  product?: Partial<ProductRepository>;
}) {
  const config = {
    get: vi.fn((key: string) => (key === 'USD_TO_COP_RATE' ? 4000 : undefined)),
  } as unknown as ConfigService;

  const cloudPricing = {
    findByProviderService: vi.fn().mockResolvedValue({
      id: 'cp-1',
      provider: 'neon',
      service: 'postgres',
      region: 'global',
      priceUsd: 19,
      unit: 'month',
      metadata: { latencyMs: 40 },
      source: 'seed',
      fetchedAt: new Date(),
    }),
    listByProvider: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    ...overrides?.cloudPricing,
  } as unknown as CloudPricingRepositoryPort;

  const exchangeRate = {
    findByPair: vi.fn().mockResolvedValue({
      id: 'er-1',
      pair: 'USD_COP',
      rate: 4000,
      source: 'seed',
      fetchedAt: new Date(),
    }),
    upsert: vi.fn(),
    ...overrides?.exchangeRate,
  } as unknown as ExchangeRateRepositoryPort;

  const quote = {
    save: vi.fn().mockImplementation((input: { dedupKey: string }) => ({
      id: 'quote-1',
      ...input,
      status: 'SENT',
      createdAt: new Date(),
    })),
    findLatestForCustomer: vi.fn(),
    findByIdForCustomer: vi.fn(),
    ...overrides?.quote,
  } as unknown as QuoteRepositoryPort;

  const product = {
    findByBusinessAndCategory: vi.fn().mockImplementation((_biz: string, category: string) => ({
      id: `prod-${category}`,
      name: `Servicio ${category}`,
      description: null,
      price: category === 'IA' ? 300 : 250,
      stock: 999,
      category,
      active: true,
    })),
    ...overrides?.product,
  } as unknown as ProductRepository;

  return new EstimatePriceTool(config, product, cloudPricing, exchangeRate, quote);
}

describe('EstimatePriceTool', () => {
  let tool: EstimatePriceTool;

  beforeEach(() => {
    tool = createTool();
  });

  it('calculates a quote in COP by default and persists a Quote', async () => {
    const result = await tool.execute(
      { services: ['desarrollo web'], database: 'neon' },
      makeCtx(),
    );

    const parsed = JSON.parse(result.output);
    expect(result.isError).toBeUndefined();
    expect(parsed.total).toMatch(/COP$/);
    expect(parsed.currency).toBe('COP');
    expect(parsed.quoteId).toBe('quote-1');
    expect(parsed.totalUsd).toBe(269); // 250 (Desarrollo) + 19 (neon postgres)
  });

  it('uses USD when currency is USD', async () => {
    const result = await tool.execute({ services: ['pagina web'], currency: 'USD' }, makeCtx());

    const parsed = JSON.parse(result.output);
    expect(parsed.currency).toBe('USD');
    expect(parsed.total).toBe('$250.00 USD');
  });

  it('resolves natural language service terms (chatbot → IA)', async () => {
    const result = await tool.execute({ services: ['chatbot'] }, makeCtx());

    const parsed = JSON.parse(result.output);
    expect(result.isError).toBeUndefined();
    expect(parsed.totalUsd).toBe(300); // IA
  });

  it('falls back to the env rate when ExchangeRate has no record', async () => {
    const toolNoRate = createTool({
      exchangeRate: { findByPair: vi.fn().mockResolvedValue(null) },
    });
    const result = await toolNoRate.execute({ services: ['chatbot'] }, makeCtx());
    const parsed = JSON.parse(result.output);
    // totalUsd 300 * 4000 (env fallback) = 1.200.000 COP
    expect(parsed.currency).toBe('COP');
    expect(parsed.total).toContain('1.200.000');
  });

  it('is idempotent: same request yields the same dedupKey (no duplicate quotes)', async () => {
    const save = vi.fn().mockResolvedValue({ id: 'quote-1', dedupKey: 'same' });
    const toolDedup = createTool({ quote: { save } });

    await toolDedup.execute({ services: ['chatbot'] }, makeCtx());
    await toolDedup.execute({ services: ['chatbot'] }, makeCtx());

    // La dedupKey debe ser igual para peticiones idénticas (el repo no duplica).
    const keys = save.mock.calls.map((c) => (c[0] as { dedupKey: string }).dedupKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('gives a friendly message when no service is recognized', async () => {
    const result = await tool.execute({ services: ['unknown_service'] }, makeCtx());
    expect(result.isError).toBe(true);
    expect(result.output).toContain('No reconocí los servicios solicitados');
  });

  it('is marked as stateful (mutatesState=true)', () => {
    expect(tool.mutatesState).toBe(true);
  });
});
