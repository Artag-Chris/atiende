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
    // Mock con precios REALES por provider para validar la resolución de cada cloud.
    findByProviderService: vi
      .fn()
      .mockImplementation((provider: string, service: string, region: string) => {
        const prices: Record<string, number> = {
          'neon:postgres': 19,
          'aws_rds:rds': 60,
          'vercel:hosting': 20,
          'render:hosting': 7,
          'aws:hosting': 25,
        };
        const price = prices[`${provider}:${service}`];
        if (!price) return null;
        return {
          id: `cp-${provider}-${service}`,
          provider,
          service,
          region,
          priceUsd: price,
          unit: 'month',
          metadata: { latencyMs: 40 },
          source: 'seed',
          fetchedAt: new Date(),
        };
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
    expect(parsed.isEstimate).toBe(true); // siempre es un estimado
    expect(parsed.note).toContain('estimación inicial');
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

  it('accepts the LLM-style input with singular "service" and "platform"', async () => {
    // Este es el input real que produjo el LLM en producción y causaba el error.
    const result = await tool.execute(
      { service: 'desarrollo web', type: 'página estática', platform: 'Amazon' },
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.output);
    // "Amazon" es ambiguo → el resolver lo trata como hosting AWS (25).
    // 250 (Desarrollo) + 25 (hosting aws) = 275.
    expect(parsed.totalUsd).toBe(275);
  });

  it('accepts "platform" as database when it is a db provider', async () => {
    const result = await tool.execute({ service: 'desarrollo web', platform: 'neon' }, makeCtx());

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.output);
    expect(parsed.totalUsd).toBe(269); // 250 + 19 (neon)
  });

  it('accepts singular "servicio" and "services" as array', async () => {
    const result = await tool.execute({ servicios: 'chatbot' }, makeCtx());

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.output);
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

  // ==========================================================================
  // 25 casos parametrizados: distintas clouds, idiomas y variantes de input.
  // ==========================================================================
  const cases = [
    // --- Español, solo servicio (COP por defecto) ---
    { name: 'es: página web', input: { services: ['pagina web'] }, services: 250, infra: 0 },
    { name: 'es: chatbot', input: { service: 'chatbot' }, services: 300, infra: 0 },
    {
      name: 'es: automatización',
      input: { servicios: ['automatizacion'] },
      services: 250,
      infra: 0,
    },
    {
      name: 'es: transformación digital',
      input: { services: ['transformacion digital'] },
      services: 250,
      infra: 0,
    },
    {
      name: 'es: cloud deployment',
      input: { services: ['cloud deployment'] },
      services: 250,
      infra: 0,
    },

    // --- Español con distintas clouds (database/hosting/platform) ---
    {
      name: 'es: web + Neon db',
      input: { service: 'desarrollo web', database: 'neon' },
      services: 250,
      infra: 19,
    },
    {
      name: 'es: web + AWS RDS',
      input: { service: 'desarrollo web', database: 'aws rds' },
      services: 250,
      infra: 60,
    },
    {
      name: 'es: web + postgres',
      input: { service: 'desarrollo web', platform: 'postgres' },
      services: 250,
      infra: 19,
    },
    {
      name: 'es: web + Vercel',
      input: { service: 'desarrollo web', hosting: 'vercel' },
      services: 250,
      infra: 20,
    },
    {
      name: 'es: web + Render',
      input: { service: 'desarrollo web', hosting: 'render' },
      services: 250,
      infra: 7,
    },
    {
      name: 'es: web + Amazon',
      input: { service: 'desarrollo web', platform: 'Amazon' },
      services: 250,
      infra: 25,
    },
    {
      name: 'es: web + AWS hosting',
      input: { service: 'desarrollo web', hosting: 'aws' },
      services: 250,
      infra: 25,
    },
    {
      name: 'es: chatbot + Neon',
      input: { service: 'chatbot', platform: 'neon' },
      services: 300,
      infra: 19,
    },
    {
      name: 'es: chatbot + AWS RDS',
      input: { service: 'chatbot', database: 'amazon rds' },
      services: 300,
      infra: 60,
    },
    {
      name: 'es: automatización + Vercel',
      input: { services: ['automatizacion'], hosting: 'vercel' },
      services: 250,
      infra: 20,
    },

    // --- Inglés (USD explícito) ---
    {
      name: 'en: website + Neon (USD)',
      input: { services: ['website'], currency: 'USD', database: 'neon' },
      services: 250,
      infra: 19,
    },
    {
      name: 'en: ai agent + AWS (USD)',
      input: { service: 'ai agent', currency: 'USD', platform: 'aws' },
      services: 300,
      infra: 25,
    },
    {
      name: 'en: automation + Render (USD)',
      input: { services: ['automation'], currency: 'USD', hosting: 'render' },
      services: 250,
      infra: 7,
    },
    {
      name: 'en: landing page + Vercel (USD)',
      input: { service: 'landing page', currency: 'USD', hosting: 'vercel' },
      services: 250,
      infra: 20,
    },
    {
      name: 'en: ecommerce + AWS RDS (USD)',
      input: { services: ['ecommerce'], currency: 'USD', database: 'aws' },
      services: 250,
      infra: 60,
    },

    // --- Mixtos / multi-servicio / variantes de input ---
    {
      name: 'es: web + chatbot juntos',
      input: { services: ['desarrollo web', 'chatbot'] },
      services: 550,
      infra: 0,
    },
    {
      name: 'es: service singular + type',
      input: { service: 'desarrollo web', type: 'sitio estatico' },
      services: 250,
      infra: 0,
    },
    {
      name: 'es: página web + región Colombia',
      input: { services: ['pagina web'], region: 'Colombia', database: 'neon' },
      services: 250,
      infra: 19,
    },
    {
      name: 'en: chatbot + region USA (USD)',
      input: { service: 'chatbot', currency: 'USD', region: 'USA' },
      services: 300,
      infra: 0,
    },
    {
      name: 'es: agente whatsapp (sin infra)',
      input: { services: ['agente de whatsapp'] },
      services: 300,
      infra: 0,
    },
  ];

  it.each(cases)('$name → total USD = $services + $infra', async ({ input, services, infra }) => {
    const result = await tool.execute(input, makeCtx());
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.output);
    expect(parsed.totalUsd).toBe(services + infra);
    expect(parsed.currency).toBe(input.currency === 'USD' ? 'USD' : 'COP');
  });
});
