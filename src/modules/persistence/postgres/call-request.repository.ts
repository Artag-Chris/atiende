import { Inject, Injectable } from '@nestjs/common';
import { PrismaDbClient, PrismaService } from './prisma.service';
import { toDomainChannel, toPrismaChannel } from './channel.mapper';
import type {
  CallRequestData,
  CallRequestInput,
  CallRequestRepositoryPort,
} from '@core/ports/call-request-repository.port';
import type { Channel } from '@core/domain/types';

@Injectable()
export class CallRequestRepository implements CallRequestRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaDbClient) {}

  async save(input: CallRequestInput): Promise<CallRequestData> {
    // Idempotencia: si la misma petición ya generó una solicitud (mismo
    // dedupKey), devolvemos la existente sin duplicar.
    const existing = await this.prisma.callRequest.findUnique({
      where: { dedupKey: input.dedupKey },
    });
    if (existing) return this.toDomain(existing);

    const row = await this.prisma.callRequest.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        customerIdentifier: input.customerIdentifier,
        channel: toPrismaChannel(input.channel),
        preferredTime: input.preferredTime,
        customerEmail: input.customerEmail,
        notes: input.notes,
        quoteId: input.quoteId,
        dedupKey: input.dedupKey,
      },
    });
    return this.toDomain(row);
  }

  async findLatestForCustomer(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<CallRequestData | null> {
    const row = await this.prisma.callRequest.findFirst({
      where: {
        businessId,
        channel: toPrismaChannel(channel),
        customerIdentifier,
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  private toDomain(row: {
    id: string;
    businessId: string;
    conversationId: string;
    customerIdentifier: string;
    channel: unknown;
    preferredTime: string;
    customerEmail: unknown;
    notes: unknown;
    quoteId: unknown;
    status: unknown;
    createdAt: Date;
  }): CallRequestData {
    return {
      id: row.id,
      businessId: row.businessId,
      conversationId: row.conversationId,
      customerIdentifier: row.customerIdentifier,
      channel: toDomainChannel(row.channel as never),
      preferredTime: row.preferredTime,
      customerEmail:
        row.customerEmail === null || row.customerEmail === undefined
          ? null
          : String(row.customerEmail),
      notes: row.notes === null || row.notes === undefined ? null : String(row.notes),
      quoteId: row.quoteId === null || row.quoteId === undefined ? null : String(row.quoteId),
      status: String(row.status),
      createdAt: row.createdAt,
    };
  }
}
