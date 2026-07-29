import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Conversation, Channel } from '@prisma/client';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<Conversation> {
    const existing = await this.prisma.conversation.findUnique({
      where: {
        businessId_channel_customerIdentifier: {
          businessId,
          channel,
          customerIdentifier,
        },
      },
    });

    if (existing) {
      await this.prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
      return existing;
    }

    return this.prisma.conversation.create({
      data: {
        businessId,
        channel,
        customerIdentifier,
        lastMessageAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  async findEscalated(
    businessId?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        status: 'ESCALATED',
        ...(businessId ? { businessId } : {}),
      },
      orderBy: { escalatedAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  async updateStatus(
    id: string,
    status: 'ACTIVE' | 'ESCALATED' | 'RESOLVED' | 'ABANDONED',
    extra?: { escalationReason?: string },
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: {
        status,
        ...(status === 'ESCALATED' && {
          escalatedAt: new Date(),
          escalationReason: extra?.escalationReason,
        }),
      },
    });
  }
}
