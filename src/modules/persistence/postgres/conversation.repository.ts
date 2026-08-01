import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { Conversation, ConversationUrgency } from '@prisma/client';
import { toDomainChannel, toPrismaChannel } from './channel.mapper';
import type { ConversationData } from '@core/ports/conversation-repository.port';
import type { Channel } from '@core/domain/types';

@Injectable()
export class ConversationRepository {
  private readonly logger = new Logger(ConversationRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async getOrCreate(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
    customerName?: string,
  ): Promise<ConversationData> {
    const row = await this.prisma.conversation.upsert({
      where: {
        businessId_channel_customerIdentifier: {
          businessId,
          channel: toPrismaChannel(channel),
          customerIdentifier,
        },
      },
      update: {
        lastMessageAt: new Date(),
        ...(customerName ? { customerName } : {}),
      },
      create: {
        businessId,
        channel: toPrismaChannel(channel),
        customerIdentifier,
        customerName,
        lastMessageAt: new Date(),
      },
    });
    return this.toDomain(row);
  }

  async findPending(
    businessId?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ConversationData[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        unreadCount: { gt: 0 },
        status: { notIn: ['RESOLVED', 'ABANDONED'] },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
    return rows.map((r) => this.toDomain(r));
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

  async findById(id: string): Promise<ConversationData | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
    });
    return row ? this.toDomain(row) : null;
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
  ): Promise<ConversationData[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        status: 'ESCALATED',
        ...(businessId ? { businessId } : {}),
      },
      orderBy: { escalatedAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
    return rows.map((r) => this.toDomain(r));
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

  private toDomain(row: Conversation): ConversationData {
    return {
      id: row.id,
      businessId: row.businessId,
      channel: toDomainChannel(row.channel),
      customerIdentifier: row.customerIdentifier,
      status: row.status,
      customerName: row.customerName,
      unreadCount: row.unreadCount,
      lastMessageAt: row.lastMessageAt,
    };
  }
}
