import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { InboundMessageRepository } from './inbound-message.repository';
import type { PrismaService } from './prisma.service';

type MockPrisma = {
  inboundMessage: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    inboundMessage: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };
}

describe('InboundMessageRepository', () => {
  let repo: InboundMessageRepository;
  let prisma: MockPrisma;

  const mockCreated = {
    id: 'msg-1',
    businessId: 'biz-1',
    externalMessageId: 'ext-1',
    rawPayload: { entry: [] },
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    repo = new InboundMessageRepository(prisma as unknown as PrismaService);
  });

  describe('save', () => {
    it('creates a new inbound message', async () => {
      prisma.inboundMessage.create.mockResolvedValue(mockCreated);

      const result = await repo.save({
        businessId: 'biz-1',
        rawPayload: { entry: [] },
        externalMessageId: 'ext-1',
      });

      expect(result).toEqual(mockCreated);
      expect(prisma.inboundMessage.create).toHaveBeenCalledWith({
        data: {
          businessId: 'biz-1',
          rawPayload: { entry: [] },
          externalMessageId: 'ext-1',
        },
      });
    });

    it('returns existing record on P2002 unique constraint violation', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
      });
      prisma.inboundMessage.create.mockRejectedValue(p2002);
      prisma.inboundMessage.findFirst.mockResolvedValue(mockCreated);

      const result = await repo.save({
        businessId: 'biz-1',
        rawPayload: { entry: [] },
        externalMessageId: 'ext-1',
      });

      expect(result).toEqual(mockCreated);
      expect(prisma.inboundMessage.findFirst).toHaveBeenCalledWith({
        where: { businessId: 'biz-1', externalMessageId: 'ext-1' },
      });
    });

    it('re-throws non-P2002 errors', async () => {
      const otherError = new Error('DB connection lost');
      prisma.inboundMessage.create.mockRejectedValue(otherError);

      await expect(
        repo.save({ businessId: 'biz-1', rawPayload: {}, externalMessageId: 'ext-1' }),
      ).rejects.toThrow('DB connection lost');
    });

    it('re-throws P2002 if findFirst returns null', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '5.0',
      });
      prisma.inboundMessage.create.mockRejectedValue(p2002);
      prisma.inboundMessage.findFirst.mockResolvedValue(null);

      await expect(
        repo.save({ businessId: 'biz-1', rawPayload: {}, externalMessageId: 'ext-1' }),
      ).rejects.toThrow('Unique constraint');
    });
  });

  describe('markProcessed', () => {
    it('updates processedAt on the record', async () => {
      const now = new Date();
      prisma.inboundMessage.update.mockResolvedValue({ ...mockCreated, processedAt: now });

      await repo.markProcessed('msg-1');

      expect(prisma.inboundMessage.update).toHaveBeenCalledWith({
        where: { id: 'msg-1' },
        data: { processedAt: expect.any(Date) },
      });
    });
  });

  describe('existsByExternalId', () => {
    it('returns true when count > 0', async () => {
      prisma.inboundMessage.count.mockResolvedValue(1);

      const result = await repo.existsByExternalId('biz-1', 'ext-1');

      expect(result).toBe(true);
    });

    it('returns false when count is 0', async () => {
      prisma.inboundMessage.count.mockResolvedValue(0);

      const result = await repo.existsByExternalId('biz-1', 'ext-1');

      expect(result).toBe(false);
    });
  });
});
