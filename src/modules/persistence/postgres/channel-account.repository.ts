import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import { toDomainChannel, toPrismaChannel } from './channel.mapper';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';
import type { Channel } from '@core/domain/types';

@Injectable()
export class ChannelAccountRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async findForBusiness(channel: Channel, businessId: string): Promise<ChannelAccountData | null> {
    const row = await this.prisma.channelAccount.findFirst({
      where: { businessId, channel: toPrismaChannel(channel) },
      orderBy: { isPrimary: 'desc' },
    });

    if (!row) return null;

    return {
      id: row.id,
      businessId: row.businessId,
      channel: toDomainChannel(row.channel),
      accountId: row.accountId,
      tokenEncrypted: row.tokenEncrypted,
      isPrimary: row.isPrimary,
    };
  }
}
