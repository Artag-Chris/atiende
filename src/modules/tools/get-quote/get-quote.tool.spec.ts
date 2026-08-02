import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetQuoteTool } from './get-quote.tool';
import type { QuoteRepositoryPort } from '@core/ports/quote-repository.port';
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

function makeQuote(overrides?: Record<string, unknown>) {
  return {
    id: 'quote-1',
    businessId: 'biz-1',
    conversationId: 'conv-1',
    customerIdentifier: '573001234567',
    channel: 'whatsapp',
    services: [{ slug: 'ai_for_business', name: 'Servicio IA', priceUsd: 300 }],
    infrastructure: {},
    breakdown: { subtotalServices: 300, subtotalInfra: 0, totalUsd: 300 },
    totalUsd: 300,
    totalDisplay: '$1.200.000 COP',
    currency: 'COP',
    dedupKey: 'abc',
    status: 'SENT',
    createdAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

function createTool(quote?: Partial<QuoteRepositoryPort>) {
  return new GetQuoteTool({
    save: vi.fn(),
    findLatestForCustomer: vi.fn(),
    findByIdForCustomer: vi.fn(),
    ...quote,
  } as unknown as QuoteRepositoryPort);
}

describe('GetQuoteTool', () => {
  let tool: GetQuoteTool;

  beforeEach(() => {
    tool = createTool();
  });

  it('returns the most recent quote of the customer (by channel identity)', async () => {
    const findLatest = vi.fn().mockResolvedValue(makeQuote());
    tool = createTool({ findLatestForCustomer: findLatest });

    const result = await tool.execute({}, makeCtx());

    expect(findLatest).toHaveBeenCalledWith('biz-1', 'whatsapp', '573001234567');
    const parsed = JSON.parse(result.output);
    expect(parsed.quoteId).toBe('quote-1');
    expect(parsed.total).toBe('$1.200.000 COP');
  });

  it('returns a clear message when there is no previous quote', async () => {
    tool = createTool({ findLatestForCustomer: vi.fn().mockResolvedValue(null) });

    const result = await tool.execute({}, makeCtx());

    const parsed = JSON.parse(result.output);
    expect(parsed.message).toContain('Aún no tienes una cotización');
  });

  it('validates quoteId belongs to the customer/channel', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    tool = createTool({ findByIdForCustomer: findById });

    const result = await tool.execute({ quoteId: 'quote-de-otro' }, makeCtx());

    expect(findById).toHaveBeenCalledWith('quote-de-otro', 'biz-1', 'whatsapp', '573001234567');
    const parsed = JSON.parse(result.output);
    expect(parsed.message).toContain('Aún no tienes una cotización');
  });

  it('is read-only (mutatesState=false)', () => {
    expect(tool.mutatesState).toBe(false);
  });
});
