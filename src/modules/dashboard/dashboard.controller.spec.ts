import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { DashboardController } from './dashboard.controller';
import type { ConversationRepositoryPort } from '@core/ports/conversation-repository.port';
import type { MessageRepositoryPort } from '@core/ports/message-repository.port';

function createConversationRepo() {
  return {
    getOrCreate: vi.fn(),
    findById: vi.fn(),
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

function makeReq(user: { businessId: string; role: string } | undefined) {
  return { user } as unknown as Request;
}

describe('DashboardController', () => {
  let controller: DashboardController;
  let conversationRepo: ReturnType<typeof createConversationRepo>;
  let messageRepo: ReturnType<typeof createMessageRepo>;

  beforeEach(() => {
    conversationRepo = createConversationRepo();
    messageRepo = createMessageRepo();
    controller = new DashboardController(conversationRepo, messageRepo);
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
});
