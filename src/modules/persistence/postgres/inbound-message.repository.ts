import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import type { InboundMessage } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class InboundMessageRepository {
  private readonly logger = new Logger(InboundMessageRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async save(data: {
    businessId: string;
    rawPayload: Record<string, unknown>;
    externalMessageId: string;
  }): Promise<InboundMessage> {
    try {
      return await this.prisma.inboundMessage.create({
        data: {
          businessId: data.businessId,
          rawPayload: data.rawPayload as unknown as Prisma.JsonObject,
          externalMessageId: data.externalMessageId,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.debug(`Duplicate inbound message ${data.externalMessageId}, fetching existing`);
        const existing = await this.prisma.inboundMessage.findFirst({
          where: {
            businessId: data.businessId,
            externalMessageId: data.externalMessageId,
          },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.inboundMessage.update({
      where: { id },
      data: { processedAt: new Date() },
    });
  }

  async findByExternalId(
    businessId: string,
    externalMessageId: string,
  ): Promise<InboundMessage | null> {
    return this.prisma.inboundMessage.findFirst({
      where: { businessId, externalMessageId },
    });
  }
}
