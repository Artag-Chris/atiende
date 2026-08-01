import { describe, it, expect, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { ChannelWebhookService } from './channel-webhook.service';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';
import type { ParsedInboundMessage } from '@core/ports/channel-provider.port';

function createService(overrides?: {
  redisSet?: ReturnType<typeof vi.fn>;
  queueAdd?: ReturnType<typeof vi.fn>;
  findByChannelAccount?: ReturnType<typeof vi.fn>;
  inboundSave?: ReturnType<typeof vi.fn>;
}) {
  const redis = { set: overrides?.redisSet ?? vi.fn() } as unknown as Redis;
  const queue = { add: overrides?.queueAdd ?? vi.fn() } as unknown as Queue;
  const businessRepo = {
    findByChannelAccount:
      overrides?.findByChannelAccount ??
      vi.fn().mockResolvedValue({ id: 'biz-1', name: 'Test Business' }),
  } as unknown as BusinessRepositoryPort;
  const inboundRepo = {
    save:
      overrides?.inboundSave ??
      vi.fn().mockResolvedValue({
        id: 'inb-1',
        businessId: 'biz-1',
        externalMessageId: 'msg-1',
        receivedAt: new Date(),
        processedAt: null,
      }),
  } as unknown as InboundMessageRepositoryPort;

  const service = new ChannelWebhookService(queue, redis, businessRepo, inboundRepo);
  return { service, redis, queue, businessRepo, inboundRepo };
}

function makeTextMessage(overrides?: Partial<ParsedInboundMessage>): ParsedInboundMessage {
  return {
    type: 'text',
    text: 'Hello',
    from: '573001234567',
    externalMessageId: 'msg-1',
    externalAccountId: '456',
    timestamp: new Date(),
    rawPayload: {},
    ...overrides,
  };
}

describe('ChannelWebhookService.persistAndEnqueue', () => {
  it('persists the inbound message before enqueueing (first webhook)', async () => {
    const { service, redis, queue, inboundRepo } = createService({
      redisSet: vi.fn().mockResolvedValue('OK'),
    });

    await service.persistAndEnqueue('whatsapp', [makeTextMessage()]);

    expect(inboundRepo.save).toHaveBeenCalledWith({
      businessId: 'biz-1',
      rawPayload: {},
      externalMessageId: 'msg-1',
    });
    expect(redis.set).toHaveBeenCalledWith(
      'idempotency:whatsapp:456:msg-1',
      '1',
      'EX',
      86_400,
      'NX',
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({
        inboundMessageId: 'inb-1',
        channel: 'whatsapp',
        businessId: 'biz-1',
        externalAccountId: '456',
      }),
      { jobId: 'whatsapp-456-msg-1' },
    );
  });

  it('skips enqueue when Redis SET NX returns null (duplicate)', async () => {
    const { service, queue, inboundRepo } = createService({
      redisSet: vi.fn().mockResolvedValue(null),
    });

    const result = await service.persistAndEnqueue('whatsapp', [makeTextMessage()]);

    expect(result).toEqual({ persistedCount: 1, enqueuedCount: 0 });
    expect(queue.add).not.toHaveBeenCalled();
    expect(inboundRepo.save).toHaveBeenCalledTimes(1);
  });

  it('continues when Redis is down (best-effort dedup, DB constraint protects)', async () => {
    const { service, queue } = createService({
      redisSet: vi.fn().mockRejectedValue(new Error('redis down')),
    });

    const result = await service.persistAndEnqueue('whatsapp', [makeTextMessage()]);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(result.enqueuedCount).toBe(1);
  });

  it('namespaces the jobId and dedup key per channel (instagram)', async () => {
    const { service, redis, queue } = createService({
      redisSet: vi.fn().mockResolvedValue('OK'),
    });
    const message = makeTextMessage({
      externalAccountId: 'IGID-178414',
      externalMessageId: 'm_ig_1',
    });

    await service.persistAndEnqueue('instagram', [message]);

    expect(redis.set).toHaveBeenCalledWith(
      'idempotency:instagram:IGID-178414:m_ig_1',
      '1',
      'EX',
      86_400,
      'NX',
    );
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ channel: 'instagram' }),
      { jobId: 'instagram-IGID-178414-m_ig_1' },
    );
  });

  it('enqueues without persisting when the business is not found', async () => {
    const { service, queue, inboundRepo } = createService({
      redisSet: vi.fn().mockResolvedValue('OK'),
      findByChannelAccount: vi.fn().mockResolvedValue(null),
    });

    const result = await service.persistAndEnqueue('whatsapp', [makeTextMessage()]);

    expect(inboundRepo.save).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'process',
      expect.objectContaining({ businessId: undefined, inboundMessageId: undefined }),
      expect.anything(),
    );
    expect(result.persistedCount).toBe(0);
    expect(result.enqueuedCount).toBe(1);
  });

  it('processes every text message in the payload (multi-message)', async () => {
    const { service, queue, inboundRepo } = createService({
      redisSet: vi.fn().mockResolvedValue('OK'),
    });

    await service.persistAndEnqueue('whatsapp', [
      makeTextMessage(),
      makeTextMessage({ externalMessageId: 'msg-2' }),
    ]);

    expect(inboundRepo.save).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('fails with 503 when the inbound message cannot be persisted', async () => {
    const { service, queue } = createService({
      redisSet: vi.fn().mockResolvedValue('OK'),
      inboundSave: vi.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(service.persistAndEnqueue('whatsapp', [makeTextMessage()])).rejects.toThrow(
      'Could not persist inbound message',
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
