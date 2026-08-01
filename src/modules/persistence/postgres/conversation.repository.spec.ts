import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationRepository } from './conversation.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  conversation: {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    conversation: {
      upsert: vi.fn().mockResolvedValue(conversationRow()),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

function conversationRow() {
  return {
    id: 'conv-1',
    businessId: 'biz-1',
    channel: 'WHATSAPP',
    customerIdentifier: '573001234567',
    customerName: 'Ana',
    status: 'ACTIVE',
    unreadCount: 0,
    lastMessageAt: new Date(),
    escalatedAt: null,
    escalationReason: null,
    urgency: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('ConversationRepository', () => {
  let repo: ConversationRepository;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new ConversationRepository(prisma as unknown as PrismaService);
  });

  describe('getOrCreate', () => {
    const uniqueKey = {
      businessId_channel_customerIdentifier: {
        businessId: 'biz-1',
        channel: 'WHATSAPP',
        customerIdentifier: '573001234567',
      },
    };

    it('creates with customerName when present', async () => {
      await repo.getOrCreate('biz-1', 'whatsapp', '573001234567', 'Ana');

      expect(prisma.conversation.upsert).toHaveBeenCalledWith({
        where: uniqueKey,
        update: expect.objectContaining({ lastMessageAt: expect.any(Date), customerName: 'Ana' }),
        create: expect.objectContaining({
          businessId: 'biz-1',
          channel: 'WHATSAPP',
          customerIdentifier: '573001234567',
          customerName: 'Ana',
          lastMessageAt: expect.any(Date),
        }),
      });
    });

    it('updates customerName on an existing conversation when provided', async () => {
      await repo.getOrCreate('biz-1', 'whatsapp', '573001234567', 'Ana');

      const call = vi.mocked(prisma.conversation.upsert).mock.calls[0][0];
      expect(call.update.customerName).toBe('Ana');
    });

    it('keeps the existing customerName when none is provided', async () => {
      await repo.getOrCreate('biz-1', 'whatsapp', '573001234567');

      const call = vi.mocked(prisma.conversation.upsert).mock.calls[0][0];
      expect(call.update.customerName).toBeUndefined();
    });
  });

  describe('findPending', () => {
    it('queries unread conversations excluding resolved/abandoned, newest first', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      await repo.findPending('biz-1', { limit: 20, offset: 5 });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-1',
          unreadCount: { gt: 0 },
          status: { notIn: ['RESOLVED', 'ABANDONED'] },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 20,
        skip: 5,
      });
    });

    it('omits businessId filter when not provided', async () => {
      prisma.conversation.findMany.mockResolvedValue([]);

      await repo.findPending();

      const call = vi.mocked(prisma.conversation.findMany).mock.calls[0][0];
      expect(call.where.businessId).toBeUndefined();
    });
  });

  describe('incrementUnread / resetUnread', () => {
    it('increments unreadCount atomically', async () => {
      await repo.incrementUnread('conv-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { unreadCount: { increment: 1 } },
      });
    });

    it('resets unreadCount to zero', async () => {
      await repo.resetUnread('conv-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { unreadCount: 0 },
      });
    });
  });
});
