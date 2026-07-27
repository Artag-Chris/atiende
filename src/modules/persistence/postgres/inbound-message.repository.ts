import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { InboundMessage } from '@prisma/client';
import type { Prisma } from '@prisma/client';

@Injectable()
export class InboundMessageRepository {
  private readonly logger = new Logger(InboundMessageRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(data: {
    businessId: string;
    rawPayload: Record<string, unknown>;
    externalMessageId: string;
  }): Promise<InboundMessage> {
    return this.prisma.inboundMessage.create({
      data: {
        businessId: data.businessId,
        rawPayload: data.rawPayload as unknown as Prisma.JsonObject,
        externalMessageId: data.externalMessageId,
      },
    });
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.inboundMessage.update({
      where: { id },
      data: { processedAt: new Date() },
    });
  }

  async existsByExternalId(businessId: string, externalMessageId: string): Promise<boolean> {
    const count = await this.prisma.inboundMessage.count({
      where: { businessId, externalMessageId },
    });
    return count > 0;
  }
}
