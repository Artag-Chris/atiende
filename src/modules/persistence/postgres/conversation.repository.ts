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
