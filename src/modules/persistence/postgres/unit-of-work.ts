import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ConversationRepository } from './conversation.repository';
import { InboundMessageRepository } from './inbound-message.repository';
import { MessageRepository } from './message.repository';
import type { UnitOfWorkContext, UnitOfWorkPort } from '@core/ports/unit-of-work.port';

@Injectable()
export class PostgresUnitOfWork implements UnitOfWorkPort {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T> {
    // El timeout por defecto de las interactive transactions de Prisma es 5s,
    // insuficiente si el agente se bloquea en una tool. Subimos ambos límites.
    return this.prisma.$transaction(
      async (tx) => {
        return fn({
          conversationRepo: new ConversationRepository(tx),
          inboundMessageRepo: new InboundMessageRepository(tx),
          messageRepo: new MessageRepository(tx),
        });
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
