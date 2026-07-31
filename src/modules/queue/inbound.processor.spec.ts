import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { InboundProcessor } from './inbound.processor';
import type { InboundMessageJobData } from '@config/queue.config';
import type { ProcessInboundMessageUseCase } from '@core/use-cases/process-inbound-message';
import type { WhatsAppAdapter } from '@modules/channels/whatsapp/whatsapp.adapter';

function createJob(overrides?: Partial<InboundMessageJobData>): Job<InboundMessageJobData> {
  return {
    id: 'job-1',
    data: {
      inboundMessageId: 'ext-1',
      businessId: 'biz-1',
      customerPhone: '573001234567',
      text: 'Hola',
      externalMessageId: 'ext-1',
      rawPayload: { entry: [] },
      ...overrides,
    },
  } as unknown as Job<InboundMessageJobData>;
}

describe('InboundProcessor', () => {
  let processInbound: {
    execute: ReturnType<typeof vi.fn>;
    markProcessed: ReturnType<typeof vi.fn>;
  };
  let whatsapp: { send: ReturnType<typeof vi.fn> };
  let processor: InboundProcessor;

  beforeEach(() => {
    processInbound = {
      execute: vi.fn().mockResolvedValue({
        responded: true,
        responseText: 'Respuesta',
        inboundMessageId: 'inb-1',
      }),
      markProcessed: vi.fn().mockResolvedValue(undefined),
    };
    whatsapp = { send: vi.fn().mockResolvedValue(undefined) };
    processor = new InboundProcessor(
      processInbound as unknown as ProcessInboundMessageUseCase,
      whatsapp as unknown as WhatsAppAdapter,
    );
  });

  it('sends the response and marks the inbound message processed after success', async () => {
    await processor.process(createJob());

    expect(processInbound.execute).toHaveBeenCalledTimes(1);
    expect(whatsapp.send).toHaveBeenCalledWith({
      businessId: 'biz-1',
      to: '573001234567',
      text: 'Respuesta',
    });
    expect(processInbound.markProcessed).toHaveBeenCalledWith('inb-1');
  });

  it('does not send nor mark processed when the message was not answered', async () => {
    processInbound.execute = vi.fn().mockResolvedValue({ responded: false });

    await processor.process(createJob());

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('does not mark processed when there is no inbound message id', async () => {
    processInbound.execute = vi.fn().mockResolvedValue({
      responded: true,
      responseText: 'Respuesta',
      inboundMessageId: null,
    });

    await processor.process(createJob());

    expect(whatsapp.send).toHaveBeenCalledTimes(1);
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('rethrows when the send fails so the job is retried', async () => {
    whatsapp.send = vi.fn().mockRejectedValue(new Error('Meta 500'));

    await expect(processor.process(createJob())).rejects.toThrow('Meta 500');
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('rethrows when the use case fails so the job is retried', async () => {
    processInbound.execute = vi.fn().mockRejectedValue(new Error('LLM timeout'));

    await expect(processor.process(createJob())).rejects.toThrow('LLM timeout');
    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });
});
