import { describe, it, expect, vi } from 'vitest';
import { PostgresUnitOfWork } from './unit-of-work';

vi.mock('./conversation.repository', () => ({
  ConversationRepository: class {
    constructor(public readonly client: unknown) {}
  },
}));

vi.mock('./inbound-message.repository', () => ({
  InboundMessageRepository: class {
    constructor(public readonly client: unknown) {}
  },
}));

vi.mock('./message.repository', () => ({
  MessageRepository: class {
    constructor(public readonly client: unknown) {}
  },
}));

describe('PostgresUnitOfWork', () => {
  it('runs the callback inside a Prisma transaction with tx-scoped repositories', async () => {
    const txClient = { conversation: 'tx', inboundMessage: 'tx', message: 'tx' };
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    };

    const uow = new PostgresUnitOfWork(prisma as never);

    let ctx: unknown;
    const result = await uow.withTransaction(async (c) => {
      ctx = c;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    const scoped = ctx as {
      conversationRepo: { client: unknown };
      inboundMessageRepo: { client: unknown };
      messageRepo: { client: unknown };
    };
    expect(scoped.conversationRepo.client).toBe(txClient);
    expect(scoped.inboundMessageRepo.client).toBe(txClient);
    expect(scoped.messageRepo.client).toBe(txClient);
  });

  it('propagates errors and rolls the transaction back', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    };
    const uow = new PostgresUnitOfWork(prisma as never);

    await expect(
      uow.withTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
