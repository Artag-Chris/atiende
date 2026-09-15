import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRepository } from './message.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  message: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    message: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe('MessageRepository', () => {
  let repo: MessageRepository;
  let prisma: MockPrisma;

  const mockMessage = {
    id: 'msg-1',
    businessId: 'biz-1',
    conversationId: 'conv-1',
    role: 'USER',
    content: [{ type: 'text', text: 'hola' }],
    tokenUsage: null,
    inboundMessageId: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new MessageRepository(prisma as unknown as PrismaService);
  });

  describe('save', () => {
    it('creates a message without an inbound link', async () => {
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        businessId: 'biz-1',
        role: 'HUMAN',
        content: [{ type: 'text', text: 'te ayudo' }],
      });

      expect(result).toEqual({ ...mockMessage, created: true });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          business: { connect: { id: 'biz-1' } },
          conversation: { connect: { id: 'conv-1' } },
          role: 'HUMAN',
          content: [{ type: 'text', text: 'te ayudo' }],
          tokenUsage: undefined,
        },
      });
    });

    it('returns created=true on first save of an inbound-linked message', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        businessId: 'biz-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual({ ...mockMessage, created: true });
      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { inboundMessageId: 'inbound-1' },
      });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          business: { connect: { id: 'biz-1' } },
          conversation: { connect: { id: 'conv-1' } },
          role: 'USER',
          content: [{ type: 'text', text: 'hola' }],
          tokenUsage: undefined,
          inboundMessage: { connect: { id: 'inbound-1' } },
        },
      });
    });

    it('returns created=false on a duplicate (job retry) without creating', async () => {
      prisma.message.findUnique.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        businessId: 'biz-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual({ ...mockMessage, created: false });
      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { inboundMessageId: 'inbound-1' },
      });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('creates when the lookup finds nothing (first attempt)', async () => {
      prisma.message.findUnique.mockResolvedValue(null);
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        businessId: 'biz-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual({ ...mockMessage, created: true });
      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { inboundMessageId: 'inbound-1' },
      });
      expect(prisma.message.create).toHaveBeenCalled();
    });
  });

  describe('findRecent', () => {
    it('queries the latest messages descending by createdAt', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await repo.findRecent('conv-1', 50);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    });

    it('returns the newest window in chronological order', async () => {
      const old = { ...mockMessage, id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') };
      const mid = { ...mockMessage, id: 'mid', createdAt: new Date('2026-01-02T00:00:00Z') };
      const recent = { ...mockMessage, id: 'recent', createdAt: new Date('2026-01-03T00:00:00Z') };
      prisma.message.findMany.mockResolvedValue([recent, mid, old]);

      const result = await repo.findRecent('conv-1', 3);

      expect(result.map((m) => m.id)).toEqual(['old', 'mid', 'recent']);
    });
  });

  describe('findPage', () => {
    it('returns the newest page in chronological order with hasMore=false', async () => {
      const rows = [
        { ...mockMessage, id: 'c', createdAt: new Date('2026-01-03T00:00:00Z') },
        { ...mockMessage, id: 'b', createdAt: new Date('2026-01-02T00:00:00Z') },
      ];
      prisma.message.findMany.mockResolvedValue(rows);

      const result = await repo.findPage('conv-1', { limit: 2 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
      expect(result.hasMore).toBe(false);
      expect(result.messages.map((m) => m.id)).toEqual(['b', 'c']);
    });

    it('filters by the exclusive before cursor', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      const before = new Date('2026-01-02T00:00:00Z');
      await repo.findPage('conv-1', { before, limit: 50 });

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1', createdAt: { lt: before } },
        orderBy: { createdAt: 'desc' },
        take: 51,
      });
    });

    it('trims the extra row and reports hasMore=true when more remain', async () => {
      prisma.message.findMany.mockResolvedValue([
        { ...mockMessage, id: 'd' },
        { ...mockMessage, id: 'c' },
        { ...mockMessage, id: 'b' },
      ]);

      const result = await repo.findPage('conv-1', { limit: 2 });

      expect(result.hasMore).toBe(true);
      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((m) => m.id)).toEqual(['c', 'd']);
    });

    it('defaults to a 50-message page', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      await repo.findPage('conv-1');

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'desc' },
        take: 51,
      });
    });
  });

  describe('findInboundActivity', () => {
    it('scopes to business and returns flattened activity rows', async () => {
      prisma.message.findMany.mockResolvedValue([
        {
          id: 'm1',
          conversationId: 'conv-1',
          createdAt: new Date('2026-07-31T10:00:00Z'),
          content: [{ type: 'text', text: 'hola' }],
          conversation: { customerIdentifier: '573001234567', customerName: 'Ana' },
        },
      ]);

      const since = new Date('2026-07-31T09:59:00Z');
      const result = await repo.findInboundActivity('biz-1', since, 20);

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: {
          role: 'USER',
          createdAt: { gt: since },
          conversation: { businessId: 'biz-1' },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: {
          id: true,
          conversationId: true,
          createdAt: true,
          content: true,
          conversation: { select: { customerIdentifier: true, customerName: true } },
        },
      });
      expect(result).toEqual([
        {
          id: 'm1',
          conversationId: 'conv-1',
          createdAt: new Date('2026-07-31T10:00:00Z'),
          content: [{ type: 'text', text: 'hola' }],
          customerIdentifier: '573001234567',
          customerName: 'Ana',
        },
      ]);
    });

    it('skips the business filter when businessId is undefined', async () => {
      prisma.message.findMany.mockResolvedValue([]);

      const since = new Date('2026-07-31T10:00:00Z');
      await repo.findInboundActivity(undefined, since, 20);

      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: 'USER', createdAt: { gt: since } },
        }),
      );
    });
  });
});
