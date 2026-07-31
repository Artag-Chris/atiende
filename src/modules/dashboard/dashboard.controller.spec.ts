import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DashboardController } from './dashboard.controller';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';
import type { WhatsAppAdapter } from '@modules/channels/whatsapp/whatsapp.adapter';

function createConversationRepo() {
  return {
    getOrCreate: vi.fn(),
    findById: vi.fn(),
    touchLastMessage: vi.fn(),
    updateStatus: vi.fn(),
    findEscalated: vi.fn().mockResolvedValue([]),
  } as unknown as ConversationRepositoryPort;
}

function createMessageRepo() {
  return {
    save: vi.fn(),
    findRecent: vi.fn().mockResolvedValue([]),
  } as unknown as MessageRepositoryPort;
}

function createWhatsappAdapter() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  } as unknown as WhatsAppAdapter;
}

const escalatedConversation = {
  id: 'conv-1',
  businessId: 'biz-1',
  channel: 'WHATSAPP',
  customerIdentifier: '573001234567',
  status: 'ESCALATED',
};

function makeReq(user: { businessId: string; role: string } | undefined) {
  return { user } as unknown as Request;
}

describe('DashboardController', () => {
  let controller: DashboardController;
  let conversationRepo: ReturnType<typeof createConversationRepo>;
  let messageRepo: ReturnType<typeof createMessageRepo>;
  let whatsapp: ReturnType<typeof createWhatsappAdapter>;

  beforeEach(() => {
    conversationRepo = createConversationRepo();
    messageRepo = createMessageRepo();
    whatsapp = createWhatsappAdapter();
    controller = new DashboardController(conversationRepo, messageRepo, whatsapp);
  });

  describe('listEscalations', () => {
    it('scopes escalations to the JWT businessId', async () => {
      conversationRepo.findEscalated = vi.fn().mockResolvedValue([
        {
          id: 'conv-1',
          businessId: 'biz-1',
          channel: 'WHATSAPP',
          customerIdentifier: 'x',
          status: 'ESCALATED',
        },
      ]);

      const result = await controller.listEscalations(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(conversationRepo.findEscalated).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({ limit: 50, offset: 0 }),
      );
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('ignores businessId query param for non-super-admin users', async () => {
      const result = await controller.listEscalations(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        'biz-2',
      );

      expect(conversationRepo.findEscalated).toHaveBeenCalledWith('biz-1', expect.any(Object));
      expect(result.total).toBe(0);
    });

    it('lets SUPER_ADMIN override businessId via query param', async () => {
      const result = await controller.listEscalations(
        makeReq({ businessId: 'biz-1', role: 'SUPER_ADMIN' }),
        'biz-2',
      );

      expect(conversationRepo.findEscalated).toHaveBeenCalledWith('biz-2', expect.any(Object));
      expect(result.total).toBe(0);
    });

    it('passes limit and offset through', async () => {
      await controller.listEscalations(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        undefined,
        '20',
        '5',
      );

      expect(conversationRepo.findEscalated).toHaveBeenCalledWith('biz-1', {
        limit: 20,
        offset: 5,
      });
    });
  });

  describe('getConversation', () => {
    it('returns conversation and messages for same-business user', async () => {
      const conversation = {
        id: 'conv-1',
        businessId: 'biz-1',
        channel: 'WHATSAPP',
        customerIdentifier: '573001234567',
        status: 'ACTIVE',
      };
      conversationRepo.findById = vi.fn().mockResolvedValue(conversation);
      messageRepo.findRecent = vi.fn().mockResolvedValue([{ id: 'm1' }]);

      const result = await controller.getConversation(
        'conv-1',
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(result.conversation).toBe(conversation);
      expect(result.messages).toHaveLength(1);
      expect(messageRepo.findRecent).toHaveBeenCalledWith('conv-1', 50);
    });

    it('throws NotFoundException when conversation does not exist', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        controller.getConversation('conv-x', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for cross-tenant conversation access', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue({
        id: 'conv-1',
        businessId: 'biz-2',
        channel: 'WHATSAPP',
        customerIdentifier: 'x',
        status: 'ACTIVE',
      });

      await expect(
        controller.getConversation('conv-1', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets SUPER_ADMIN access conversations from any business', async () => {
      const conversation = {
        id: 'conv-1',
        businessId: 'biz-2',
        channel: 'WHATSAPP',
        customerIdentifier: 'x',
        status: 'ACTIVE',
      };
      conversationRepo.findById = vi.fn().mockResolvedValue(conversation);

      const result = await controller.getConversation(
        'conv-1',
        makeReq({ businessId: 'biz-1', role: 'SUPER_ADMIN' }),
      );

      expect(result.conversation.businessId).toBe('biz-2');
    });
  });

  describe('sendHumanReply', () => {
    it('sends, persists as HUMAN and touches lastMessageAt', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      const result = await controller.sendHumanReply(
        'conv-1',
        { text: '  Hola, te atiende Christian  ' },
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(result).toEqual({ ok: true });
      expect(whatsapp.send).toHaveBeenCalledWith({
        businessId: 'biz-1',
        to: '573001234567',
        text: 'Hola, te atiende Christian',
      });
      expect(messageRepo.save).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        role: 'HUMAN',
        content: [{ type: 'text', text: 'Hola, te atiende Christian' }],
      });
      expect(conversationRepo.touchLastMessage).toHaveBeenCalledWith('conv-1');
    });

    it('rejects empty or whitespace-only text', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: '   ' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(whatsapp.send).not.toHaveBeenCalled();
    });

    it('rejects text longer than 1000 chars', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 'x'.repeat(1001) },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects non-string text payloads', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 12345 as unknown as string },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(whatsapp.send).not.toHaveBeenCalled();
    });

    it('throws ServiceUnavailableException when WhatsApp adapter is not configured', async () => {
      controller = new DashboardController(conversationRepo, messageRepo, undefined);
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 'hola' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(messageRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when conversation does not exist', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        controller.sendHumanReply(
          'conv-x',
          { text: 'hola' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for cross-tenant conversation', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue({
        ...escalatedConversation,
        businessId: 'biz-2',
      });

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 'hola' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when conversation is not escalated', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue({
        ...escalatedConversation,
        status: 'ACTIVE',
      });

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 'hola' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(whatsapp.send).not.toHaveBeenCalled();
    });

    it('does not persist when the WhatsApp send fails', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);
      whatsapp.send = vi.fn().mockRejectedValue(new Error('Meta 500'));

      await expect(
        controller.sendHumanReply(
          'conv-1',
          { text: 'hola' },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(messageRepo.save).not.toHaveBeenCalled();
      expect(conversationRepo.touchLastMessage).not.toHaveBeenCalled();
    });
  });

  describe('resolveConversation', () => {
    it('marks the conversation as RESOLVED', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(escalatedConversation);

      const result = await controller.resolveConversation(
        'conv-1',
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(result).toEqual({ ok: true });
      expect(conversationRepo.updateStatus).toHaveBeenCalledWith('conv-1', 'RESOLVED');
    });

    it('throws NotFoundException when conversation does not exist', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue(null);

      await expect(
        controller.resolveConversation('conv-x', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for cross-tenant conversation', async () => {
      conversationRepo.findById = vi.fn().mockResolvedValue({
        ...escalatedConversation,
        businessId: 'biz-2',
      });

      await expect(
        controller.resolveConversation('conv-1', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
