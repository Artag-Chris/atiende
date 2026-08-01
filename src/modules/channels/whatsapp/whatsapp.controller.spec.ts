import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { WhatsAppController } from './whatsapp.controller';
import type { WhatsAppAdapter } from './whatsapp.adapter';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';

const externalAccountId = '573001234567';
const externalMessageId = 'msg-1';

function createController(overrides?: {
  redisSet?: ReturnType<typeof vi.fn>;
  queueAdd?: ReturnType<typeof vi.fn>;
  parseWebhook?: ReturnType<typeof vi.fn>;
  findByChannelAccount?: ReturnType<typeof vi.fn>;
  inboundSave?: ReturnType<typeof vi.fn>;
}) {
  const redis = { set: overrides?.redisSet ?? vi.fn() } as unknown as Redis;
  const queue = { add: overrides?.queueAdd ?? vi.fn() } as unknown as Queue;
  const whatsapp = {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseInboundWebhook: overrides?.parseWebhook ?? vi.fn(),
  } as unknown as WhatsAppAdapter;
  const config = {
    getOrThrow: () => 'test-token',
    get: () => 'development',
  } as unknown as ConfigService;
  const businessRepo = {
    findByChannelAccount:
      overrides?.findByChannelAccount ??
      vi.fn().mockResolvedValue({
        id: 'biz-1',
        name: 'Test Business',
        whatsappPhoneId: externalAccountId,
        settings: {},
      }),
  } as unknown as BusinessRepositoryPort;
  const inboundRepo = {
    save:
      overrides?.inboundSave ??
      vi.fn().mockResolvedValue({
        id: 'inb-1',
        businessId: 'biz-1',
        externalMessageId,
        receivedAt: new Date(),
        processedAt: null,
      }),
  } as unknown as InboundMessageRepositoryPort;

  const controller = new WhatsAppController(
    config,
    whatsapp,
    queue,
    redis,
    businessRepo,
    inboundRepo,
  );
  return { controller, redis, queue, whatsapp, businessRepo, inboundRepo };
}

describe('WhatsAppController', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123',
        changes: [
          {
            value: {
              messages: [
                {
                  from: '573001234567',
                  id: 'msg-1',
                  text: { body: 'Hello' },
                  type: 'text',
                },
              ],
              metadata: { phone_number_id: '456' },
            },
          },
        ],
      },
    ],
  };

  const mockReq = (body: string) => ({ rawBody: Buffer.from(body) }) as RawBodyRequest<Request>;

  function makeTextMessage() {
    return [
      {
        type: 'text' as const,
        text: 'Hello',
        from: externalAccountId,
        externalMessageId,
        externalAccountId,
        rawPayload: {},
      },
    ];
  }

  describe('handleInbound - persist + idempotency', () => {
    it('persists the inbound message before enqueueing (first webhook)', async () => {
      const { controller, redis, queue, inboundRepo } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(inboundRepo.save).toHaveBeenCalledWith({
        businessId: 'biz-1',
        rawPayload: {},
        externalMessageId,
      });
      expect(redis.set).toHaveBeenCalledWith(
        `idempotency:whatsapp:${externalAccountId}:${externalMessageId}`,
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
          externalAccountId,
        }),
        { jobId: `whatsapp:${externalAccountId}-${externalMessageId}` },
      );
    });

    it('skips enqueue when Redis SET NX returns null (duplicate)', async () => {
      const { controller, queue, inboundRepo } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue(null),
      });

      const result = await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(result).toEqual({ status: 'ok' });
      expect(queue.add).not.toHaveBeenCalled();
      expect(inboundRepo.save).toHaveBeenCalledTimes(1);
    });

    it('continues when Redis is down (best-effort dedup, DB constraint protects)', async () => {
      const { controller, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockRejectedValue(new Error('redis down')),
      });

      const result = await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(result).toEqual({ status: 'ok' });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('uses jobId namespaced by channel matching externalAccountId-externalMessageId', async () => {
      const { controller, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(queue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({
          channel: 'whatsapp',
          businessId: 'biz-1',
          externalAccountId,
          externalMessageId,
        }),
        { jobId: `whatsapp:${externalAccountId}-${externalMessageId}` },
      );
    });

    it('enqueues without persisting when the business is not found', async () => {
      const { controller, queue, inboundRepo } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
        findByChannelAccount: vi.fn().mockResolvedValue(null),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(inboundRepo.save).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('processes every text message in the payload (multi-message)', async () => {
      const { controller, queue, inboundRepo } = createController({
        parseWebhook: vi.fn().mockReturnValue([
          ...makeTextMessage(),
          {
            type: 'text' as const,
            text: 'Segundo mensaje',
            from: externalAccountId,
            externalMessageId: 'msg-2',
            externalAccountId,
            rawPayload: {},
          },
        ]),
        redisSet: vi.fn().mockResolvedValue('OK'),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(inboundRepo.save).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
    });

    it('fails with 503 when the inbound message cannot be persisted', async () => {
      const { controller, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
        inboundSave: vi.fn().mockRejectedValue(new Error('db down')),
      });

      await expect(controller.handleInbound(mockReq(JSON.stringify(payload)), '')).rejects.toThrow(
        'Could not persist inbound message',
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
