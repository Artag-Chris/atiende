import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { Message, MessageRole } from '@prisma/client';
import type { InboundActivityItem, MessageData } from '@core/ports/message-repository.port';
import type { Prisma } from '@prisma/client';

@Injectable()
export class MessageRepository {
  private readonly logger = new Logger(MessageRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async save(data: {
    conversationId: string;
    businessId: string;
    role: MessageRole;
    content: Record<string, unknown> | Array<Record<string, unknown>>;
    tokenUsage?: Record<string, unknown>;
    inboundMessageId?: string;
  }): Promise<Message & { created: boolean }> {
    const createData: Prisma.MessageCreateInput = {
      business: { connect: { id: data.businessId } },
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

  async findPage(
    conversationId: string,
    options: { before?: Date; limit?: number } = {},
  ): Promise<{ messages: MessageData[]; hasMore: boolean }> {
    const limit = options.limit ?? 50;

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    // Pedimos un extra para saber si quedan mensajes más viejos.
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();

    return {
      messages: page.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        tokenUsage: row.tokenUsage,
        createdAt: row.createdAt,
      })),
      hasMore,
    };
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
