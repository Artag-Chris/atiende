import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { InboundProcessor } from './inbound.processor';
import type { InboundMessageJobData } from '@config/queue.config';
import type { ProcessInboundMessageUseCase } from '@core/use-cases/process-inbound-message';
import type { ChannelRouterService } from '@modules/channels/router/channel-router.service';

function createJob(overrides?: Partial<InboundMessageJobData>): Job<InboundMessageJobData> {
  return {
    id: 'job-1',
    data: {
      inboundMessageId: 'ext-1',
      channel: 'whatsapp',
      businessId: 'biz-1',
      externalAccountId: 'phone-id-1',
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
  let channels: { send: ReturnType<typeof vi.fn> };
  let processor: InboundProcessor;

  beforeEach(() => {
    processInbound = {
      execute: vi.fn().mockResolvedValue({
        responded: true,
        responseText: 'Respuesta',
        inboundMessageId: 'inb-1',
        businessId: 'biz-1',
      }),
      markProcessed: vi.fn().mockResolvedValue(undefined),
    };
    channels = { send: vi.fn().mockResolvedValue(undefined) };
    processor = new InboundProcessor(
      processInbound as unknown as ProcessInboundMessageUseCase,
      channels as unknown as ChannelRouterService,
    );
  });

  it('sends the response via the channel router and marks the inbound message processed after success', async () => {
    await processor.process(createJob());

    expect(processInbound.execute).toHaveBeenCalledTimes(1);
    expect(processInbound.execute).toHaveBeenCalledWith({
      channel: 'whatsapp',
      externalAccountId: 'phone-id-1',
      from: '573001234567',
      text: 'Hola',
      externalMessageId: 'ext-1',
      rawPayload: { entry: [] },
      customerName: undefined,
    });
    expect(channels.send).toHaveBeenCalledWith('whatsapp', {
      businessId: 'biz-1',
      to: '573001234567',
      text: 'Respuesta',
    });
    expect(processInbound.markProcessed).toHaveBeenCalledWith('inb-1');
  });

  it('does not send nor mark processed when the message was not answered', async () => {
    processInbound.execute = vi.fn().mockResolvedValue({ responded: false });

    await processor.process(createJob());

    expect(channels.send).not.toHaveBeenCalled();
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('marks processed without sending when escalated (no response)', async () => {
    processInbound.execute = vi.fn().mockResolvedValue({
      responded: false,
      skipReason: 'escalated',
      inboundMessageId: 'inb-esc',
    });

    await processor.process(createJob());

    expect(channels.send).not.toHaveBeenCalled();
    expect(processInbound.markProcessed).toHaveBeenCalledWith('inb-esc');
  });

  it('does not mark processed when there is no inbound message id', async () => {
    processInbound.execute = vi.fn().mockResolvedValue({
      responded: true,
      responseText: 'Respuesta',
      inboundMessageId: null,
      businessId: 'biz-1',
    });

    await processor.process(createJob());

    expect(channels.send).toHaveBeenCalledTimes(1);
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('rethrows when the send fails so the job is retried', async () => {
    channels.send = vi.fn().mockRejectedValue(new Error('Meta 500'));

    await expect(processor.process(createJob())).rejects.toThrow('Meta 500');
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });

  it('rethrows when the use case fails so the job is retried', async () => {
    processInbound.execute = vi.fn().mockRejectedValue(new Error('LLM timeout'));

    await expect(processor.process(createJob())).rejects.toThrow('LLM timeout');
    expect(channels.send).not.toHaveBeenCalled();
    expect(processInbound.markProcessed).not.toHaveBeenCalled();
  });
});
