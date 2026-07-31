import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { Conversation, Channel, ConversationUrgency } from '@prisma/client';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async getOrCreate(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
    customerName?: string,
  ): Promise<Conversation> {
    return this.prisma.conversation.upsert({
      where: {
        businessId_channel_customerIdentifier: {
          businessId,
          channel,
          customerIdentifier,
        },
      },
      update: {
        lastMessageAt: new Date(),
        ...(customerName ? { customerName } : {}),
      },
      create: {
        businessId,
        channel,
        customerIdentifier,
        customerName,
        lastMessageAt: new Date(),
      },
    });
  }

  async findPending(
    businessId?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        unreadCount: { gt: 0 },
        status: { notIn: ['RESOLVED', 'ABANDONED'] },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  async incrementUnread(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: { increment: 1 } },
    });
  }

  async resetUnread(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
    });
  }

  async touchLastMessage(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date() },
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
    extra?: { escalationReason?: string; urgency?: string },
  ): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: {
        status,
        ...(status === 'ESCALATED' && {
          escalatedAt: new Date(),
          escalationReason: extra?.escalationReason,
          urgency: (extra?.urgency as ConversationUrgency) ?? undefined,
        }),
      },
    });
  }

  async expireEscalated(cutoff: Date): Promise<number> {
    const result = await this.prisma.conversation.updateMany({
      where: {
        status: 'ESCALATED',
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: cutoff } }],
      },
      data: { status: 'ACTIVE' },
    });
    return result.count;
  }
}
