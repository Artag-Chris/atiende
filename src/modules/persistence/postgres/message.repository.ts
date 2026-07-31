import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { Message, MessageRole } from '@prisma/client';
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
  }): Promise<Message> {
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
      return this.prisma.message.create({ data: createData });
    }

    // Idempotente: si el USER message ya se guardó en un intento anterior del
    // mismo mensaje (job reintentado), no lo duplicamos.
    return this.prisma.message.upsert({
      where: { inboundMessageId: data.inboundMessageId },
      create: createData,
      update: {},
    });
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
