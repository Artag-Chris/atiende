import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRepository } from './message.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  message: {
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    message: {
      create: vi.fn(),
      upsert: vi.fn(),
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

      expect(result).toEqual(mockMessage);
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          conversation: { connect: { id: 'conv-1' } },
          role: 'HUMAN',
          content: [{ type: 'text', text: 'te ayudo' }],
          tokenUsage: undefined,
        },
      });
    });

    it('upserts by inboundMessageId to stay idempotent', async () => {
      prisma.message.upsert.mockResolvedValue(mockMessage);

      const result = await repo.save({
        conversationId: 'conv-1',
        role: 'USER',
        content: [{ type: 'text', text: 'hola' }],
        inboundMessageId: 'inbound-1',
      });

      expect(result).toEqual(mockMessage);
      expect(prisma.message.upsert).toHaveBeenCalledWith({
        where: { inboundMessageId: 'inbound-1' },
        create: {
          conversation: { connect: { id: 'conv-1' } },
          role: 'USER',
          content: [{ type: 'text', text: 'hola' }],
          tokenUsage: undefined,
          inboundMessage: { connect: { id: 'inbound-1' } },
        },
        update: {},
      });
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
});
