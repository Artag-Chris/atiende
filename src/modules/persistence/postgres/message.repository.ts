import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Message, MessageRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

@Injectable()
export class MessageRepository {
  private readonly logger = new Logger(MessageRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(data: {
    conversationId: string;
    role: MessageRole;
    content: Record<string, unknown> | Array<Record<string, unknown>>;
    tokenUsage?: Record<string, unknown>;
  }): Promise<Message> {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        role: data.role,
        content: data.content as unknown as Prisma.JsonObject,
        tokenUsage: data.tokenUsage ? (data.tokenUsage as unknown as Prisma.JsonObject) : undefined,
      },
    });
  }

  async findRecent(conversationId: string, limit: number = 20): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
