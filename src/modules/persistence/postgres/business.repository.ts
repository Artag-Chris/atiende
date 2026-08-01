import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Business } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { toPrismaChannel } from './channel.mapper';
import type { Channel } from '@core/domain/types';

@Injectable()
export class BusinessRepository {
  private readonly logger = new Logger(BusinessRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByChannelAccount(channel: Channel, accountId: string): Promise<Business | null> {
    const account = await this.prisma.channelAccount.findUnique({
      where: { channel_accountId: { channel: toPrismaChannel(channel), accountId } },
      include: { business: true },
    });
    if (account) return account.business;

    if (channel === 'whatsapp') {
      // Fallback de transición: lookup por la columna legacy de WhatsApp.
      return this.prisma.business.findUnique({
        where: { whatsappPhoneId: accountId },
      });
    }

    return null;
  }

  async findById(id: string): Promise<Business | null> {
    return this.prisma.business.findUnique({
      where: { id },
    });
  }

  async create(data: {
    name: string;
    whatsappPhoneId: string;
    whatsappTokenEncrypted: string;
    systemPromptExtras?: string;
    settings?: Record<string, unknown>;
  }): Promise<Business> {
    return this.prisma.business.create({
      data: {
        name: data.name,
        whatsappPhoneId: data.whatsappPhoneId,
        whatsappTokenEncrypted: data.whatsappTokenEncrypted,
        systemPromptExtras: data.systemPromptExtras,
        settings: (data.settings ?? {}) as unknown as Prisma.JsonObject,
      },
    });
  }
}
