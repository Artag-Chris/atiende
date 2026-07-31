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
        role: 'HUMAN',
        content: [{ type: 'text', text: 'te ayudo' }],
      });

      expect(result).toEqual({ ...mockMessage, created: true });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversation: { connect: { id: 'conv-1' } },
          role: 'HUMAN',
          content: [{ type: 'text', text: 'te ayudo' }],
          tokenUsage: undefined,
        },
      });
    });

    it('returns created=true on first save of an inbound-linked message', async () => {
      prisma.message.create.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual({ ...mockMessage, created: true });
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversation: { connect: { id: 'conv-1' } },
          role: 'USER',
          content: [{ type: 'text', text: 'hola' }],
          tokenUsage: undefined,
          inboundMessage: { connect: { id: 'inbound-1' } },
        },
      });
      expect(prisma.message.findUnique).not.toHaveBeenCalled();
    });

    it('returns created=false on a duplicate (job retry) without duplicating', async () => {
      const conflict = new Error('Unique constraint failed');
      Object.assign(conflict, { code: 'P2002' });
      prisma.message.create.mockRejectedValue(conflict);
      prisma.message.findUnique.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual({ ...mockMessage, created: false });
      expect(prisma.message.findUnique).toHaveBeenCalledWith({
        where: { inboundMessageId: 'inbound-1' },
      });
    });

    it('rethrows when the duplicate lookup finds nothing', async () => {
      const conflict = new Error('Unique constraint failed');
      Object.assign(conflict, { code: 'P2002' });
      prisma.message.create.mockRejectedValue(conflict);
      prisma.message.findUnique.mockResolvedValue(null);

      await expect(
        repo.save({
          conversationId: 'conv-1',
          role: 'USER',
          content: [{ type: 'text', text: 'hola' }],
          inboundMessageId: 'inbound-1',
        }),
      ).rejects.toThrow('Unique constraint failed');
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
