import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import type { WhatsAppAdapter } from './whatsapp.adapter';
import type { ChannelWebhookService } from '../webhook/channel-webhook.service';

function createController(overrides?: {
  verifySignature?: ReturnType<typeof vi.fn>;
  parseWebhook?: ReturnType<typeof vi.fn>;
  persistAndEnqueue?: ReturnType<typeof vi.fn>;
  env?: string;
}) {
  const config = {
    getOrThrow: () => 'test-token',
    get: () => overrides?.env ?? 'development',
  } as unknown as ConfigService;
  const whatsapp = {
    verifyWebhookSignature: overrides?.verifySignature ?? vi.fn().mockReturnValue(true),
    parseInboundWebhook: overrides?.parseWebhook ?? vi.fn().mockReturnValue([]),
  } as unknown as WhatsAppAdapter;
  const webhookService = {
    persistAndEnqueue:
      overrides?.persistAndEnqueue ??
      vi.fn().mockResolvedValue({ persistedCount: 1, enqueuedCount: 1 }),
  } as unknown as ChannelWebhookService;

  const controller = new WhatsAppController(config, whatsapp, webhookService);
  return { controller, whatsapp, webhookService };
}

const mockReq = (body: string) => ({ rawBody: Buffer.from(body) }) as RawBodyRequest<Request>;

describe('WhatsAppController', () => {
  describe('verifyWebhook', () => {
    it('returns the challenge for a valid subscribe request', () => {
      const { controller } = createController();

      expect(controller.verifyWebhook('subscribe', 'test-token', 'challenge-123')).toBe(
        'challenge-123',
      );
    });

    it('throws UnauthorizedException on a token mismatch', () => {
      const { controller } = createController();

      expect(() => controller.verifyWebhook('subscribe', 'wrong', 'challenge-123')).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('handleInbound', () => {
    it('delegates persist+enqueue to the shared webhook service with channel whatsapp', async () => {
      const { controller, whatsapp, webhookService } = createController({
        parseWebhook: vi
          .fn()
          .mockReturnValue([
            { type: 'text', text: 'Hola', from: '573001234567', externalMessageId: 'm-1' },
          ]),
      });
      const payload = { object: 'whatsapp_business_account', entry: [] };

      const result = await controller.handleInbound(mockReq(JSON.stringify(payload)), 'sha256=abc');

      expect(whatsapp.verifyWebhookSignature).toHaveBeenCalled();
      expect(webhookService.persistAndEnqueue).toHaveBeenCalledWith('whatsapp', [
        expect.objectContaining({ type: 'text', text: 'Hola' }),
      ]);
      expect(result).toEqual({ status: 'ok' });
    });

    it('proceeds without signature in dev mode', async () => {
      const { controller, webhookService } = createController({
        parseWebhook: vi
          .fn()
          .mockReturnValue([
            { type: 'text', text: 'Hola', from: '573001234567', externalMessageId: 'm-1' },
          ]),
        env: 'development',
      });

      const result = await controller.handleInbound(mockReq('{}'), '');

      expect(webhookService.persistAndEnqueue).toHaveBeenCalled();
      expect(result).toEqual({ status: 'ok' });
    });

    it('rejects a missing signature in production', async () => {
      const { controller } = createController({ env: 'production' });

      await expect(controller.handleInbound(mockReq('{}'), '')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an invalid signature', async () => {
      const { controller } = createController({ verifySignature: vi.fn().mockReturnValue(false) });

      await expect(controller.handleInbound(mockReq('{}'), 'sha256=bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects invalid JSON', async () => {
      const { controller } = createController();

      await expect(controller.handleInbound(mockReq('not-json'), 'sha256=abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an empty body', async () => {
      const { controller } = createController();

      await expect(
        controller.handleInbound({ rawBody: undefined } as RawBodyRequest<Request>, ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not delegate when there are no text messages', async () => {
      const { controller, webhookService } = createController({
        parseWebhook: vi
          .fn()
          .mockReturnValue([{ type: 'unsupported', from: 'x', externalMessageId: 'm-1' }]),
      });

      const result = await controller.handleInbound(mockReq('{}'), 'sha256=abc');

      expect(webhookService.persistAndEnqueue).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'ok' });
    });
  });
});
