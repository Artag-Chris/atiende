import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleCallTool } from './schedule-call.tool';
import type { CallSchedulerPort } from '@core/ports/call-scheduler.port';
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

function createTool(overrides?: {
  scheduler?: Partial<CallSchedulerPort>;
  quote?: Partial<QuoteRepositoryPort>;
}) {
  const scheduler = {
    requestCall: vi.fn().mockResolvedValue({ id: 'call-1', status: 'PENDING' }),
    ...overrides?.scheduler,
  } as unknown as CallSchedulerPort;

  const quote = {
    findLatestForCustomer: vi.fn().mockResolvedValue(null),
    findByIdForCustomer: vi.fn(),
    save: vi.fn(),
    ...overrides?.quote,
  } as unknown as QuoteRepositoryPort;

  return new ScheduleCallTool(scheduler, quote);
}

describe('ScheduleCallTool', () => {
  let tool: ScheduleCallTool;

  beforeEach(() => {
    tool = createTool();
  });

  it('registers a call request and persists it', async () => {
    const result = await tool.execute(
      {
        preferredTime: 'mañana a las 3pm',
        customerEmail: 'cliente@mail.com',
        notes: 'Quiere cotización de web',
      },
      makeCtx(),
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.output);
    expect(parsed.callRequestId).toBe('call-1');
    expect(parsed.status).toBe('PENDING');
    expect(parsed.message).toContain('Hemos registrado tu solicitud');
  });

  it('passes the quoteId of the latest quote when it exists', async () => {
    const requestCall = vi.fn().mockResolvedValue({ id: 'call-1', status: 'PENDING' });
    const findQuote = vi.fn().mockResolvedValue({ id: 'quote-9' });
    tool = createTool({
      scheduler: { requestCall },
      quote: { findLatestForCustomer: findQuote },
    });

    await tool.execute({ preferredTime: 'hoy a las 5' }, makeCtx());

    expect(findQuote).toHaveBeenCalledWith('biz-1', 'whatsapp', '573001234567');
    const callInput = requestCall.mock.calls[0][0] as { quoteId: string };
    expect(callInput.quoteId).toBe('quote-9');
  });

  it('is marked as stateful (mutatesState=true)', () => {
    expect(tool.mutatesState).toBe(true);
  });
});
