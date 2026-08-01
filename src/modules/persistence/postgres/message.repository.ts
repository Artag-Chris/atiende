import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { Message, MessageRole } from '@prisma/client';
import type { InboundActivityItem } from '@core/ports/message-repository.port';
import type { Prisma } from '@prisma/client';

@Injectable()
export class MessageRepository {
  private readonly logger = new Logger(MessageRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async save(data: {
    conversationId: string;
    role: MessageRole;
    content: Record<string, unknown> | Array<Record<string, unknown>>;
    tokenUsage?: Record<string, unknown>;
    inboundMessageId?: string;
  }): Promise<Message & { created: boolean }> {
    const createData: Prisma.MessageCreateInput = {
      conversation: { connect: { id: data.conversationId } },
      role: data.role,
      content: data.content as unknown as Prisma.JsonObject,
      tokenUsage: data.tokenUsage ? (data.tokenUsage as unknown as Prisma.JsonObject) : undefined,
      ...(data.inboundMessageId
        ? { inboundMessage: { connect: { id: data.inboundMessageId } } }
        : {}),
    };

    if (!data.inboundMessageId) {
      const created = await this.prisma.message.create({ data: createData });
      return { ...created, created: true };
    }

    // Idempotente: si el USER message ya se guardó en un intento anterior del
    // mismo mensaje (job reintentado), no lo duplicamos ni re-contamos.
    // Buscamos PRIMERO para no depender del catch (el create con unique
    // falla con P2002 y aborta la transacción de Postgres en curso → 25P02).
    const existing = await this.prisma.message.findUnique({
      where: { inboundMessageId: data.inboundMessageId },
    });
    if (existing) return { ...existing, created: false };

    const created = await this.prisma.message.create({ data: createData });
    return { ...created, created: true };
  }

  async findInboundActivity(
    businessId: string | undefined,
    since: Date,
    limit: number = 50,
  ): Promise<InboundActivityItem[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        role: 'USER',
        createdAt: { gt: since },
        ...(businessId ? { conversation: { businessId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        conversationId: true,
        createdAt: true,
        content: true,
        conversation: { select: { customerIdentifier: true, customerName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      createdAt: row.createdAt,
      content: row.content,
      customerIdentifier: row.conversation.customerIdentifier,
      customerName: row.conversation.customerName,
    }));
  }

  async findRecent(conversationId: string, limit: number = 20): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    // Desc → asc para devolver el historial en orden cronológico.
    return rows.reverse();
  }
}
