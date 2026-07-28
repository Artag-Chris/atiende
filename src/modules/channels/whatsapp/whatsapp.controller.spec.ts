import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { WhatsAppController } from './whatsapp.controller';
import type { WhatsAppAdapter } from './whatsapp.adapter';

function createController(overrides?: {
  redisSet?: ReturnType<typeof vi.fn>;
  queueAdd?: ReturnType<typeof vi.fn>;
  parseWebhook?: ReturnType<typeof vi.fn>;
}) {
  const redis = { set: overrides?.redisSet ?? vi.fn() } as unknown as Redis;
  const queue = { add: overrides?.queueAdd ?? vi.fn() } as unknown as Queue;
  const whatsapp = {
    verifyWebhookSignature: vi.fn().mockReturnValue(true),
    parseInboundWebhook: overrides?.parseWebhook ?? vi.fn(),
  } as unknown as WhatsAppAdapter;
  const config = { getOrThrow: () => 'test-token', get: () => 'development' } as unknown as ConfigService;

  const controller = new WhatsAppController(config, whatsapp, queue, redis);
  return { controller, redis, queue, whatsapp };
}

describe('WhatsAppController', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '123',
      changes: [{
        value: {
          messages: [{
            from: '573001234567',
            id: 'msg-1',
            text: { body: 'Hello' },
            type: 'text',
          }],
          metadata: { phone_number_id: '456' },
        },
      }],
    }],
  };

  const mockReq = (body: string) =>
    ({ rawBody: Buffer.from(body) } as any);

  const externalAccountId = '573001234567';
  const externalMessageId = 'msg-1';

  function makeTextMessage() {
    return [{
      type: 'text' as const,
      text: 'Hello',
      from: externalAccountId,
      externalMessageId,
      externalAccountId,
      rawPayload: {},
    }];
  }

  describe('handleInbound - idempotency', () => {
    it('enqueues job when Redis SET NX succeeds (first webhook)', async () => {
      const { controller, redis, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(redis.set).toHaveBeenCalledWith(
        `idempotency:${externalAccountId}:${externalMessageId}`,
        '1',
        'EX',
        86_400,
        'NX',
      );
      expect(queue.add).toHaveBeenCalled();
    });

    it('returns dedup=true when Redis SET NX returns null (duplicate)', async () => {
      const { controller, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue(null),
      });

      const result = await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(result).toEqual({ status: 'ok', dedup: true });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('uses jobId matching externalAccountId-externalMessageId', async () => {
      const { controller, queue } = createController({
        parseWebhook: vi.fn().mockReturnValue(makeTextMessage()),
        redisSet: vi.fn().mockResolvedValue('OK'),
      });

      await controller.handleInbound(mockReq(JSON.stringify(payload)), '');

      expect(queue.add).toHaveBeenCalledWith(
        'process',
        expect.objectContaining({ businessId: externalAccountId, externalMessageId }),
        { jobId: `${externalAccountId}-${externalMessageId}` },
      );
    });
  });
});
