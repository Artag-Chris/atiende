import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { ParsedInboundMessage } from '@core/ports/channel-provider.port';
import type { Channel } from '@core/domain/types';
import { QUEUE_NAMES, type InboundMessageJobData } from '@config/queue.config';
import {
  BUSINESS_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  REDIS_CLIENT_TOKEN,
} from '@core/tokens';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';

export interface WebhookProcessResult {
  persistedCount: number;
  enqueuedCount: number;
}

/**
 * Pipeline compartido de webhook entrante para todos los canales:
 * 1. Resuelve el business por (channel, externalAccountId).
 * 2. Persiste el InboundMessage ANTES de encolar (NFR-8 zero-loss).
 * 3. Dedup best-effort en Redis con namespace por canal.
 * 4. Encola el job de procesamiento con jobId determinístico por canal.
 *
 * WhatsApp/Instagram/Messenger comparten este service vía sus controllers.
 */
@Injectable()
export class ChannelWebhookService {
  private readonly logger = new Logger(ChannelWebhookService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.INBOUND_MESSAGE)
    private readonly inboundQueue: Queue<InboundMessageJobData>,
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
    @Inject(INBOUND_MESSAGE_REPOSITORY_TOKEN)
    private readonly inboundRepo: InboundMessageRepositoryPort,
  ) {}

  async persistAndEnqueue(
    channel: Channel,
    messages: ParsedInboundMessage[],
  ): Promise<WebhookProcessResult> {
    let persistedCount = 0;
    let enqueuedCount = 0;

    for (const m of messages) {
      const text = m.text;
      if (!text) continue;

      // NFR-8 zero-loss: persiste el mensaje ANTES de encolar. Si el enqueue
      // falla (Redis/BullMQ caídos), Meta reintenta el webhook y el dedup por
      // constraint único en DB evita duplicados — nada se pierde.
      let inboundId: string | undefined;
      const business = await this.businessRepo.findByChannelAccount(channel, m.externalAccountId);
      if (business) {
        try {
          const saved = await this.inboundRepo.save({
            businessId: business.id,
            rawPayload: m.rawPayload as Record<string, unknown>,
            externalMessageId: m.externalMessageId,
          });
          inboundId = saved.id;
          persistedCount += 1;
        } catch (error) {
          this.logger.error(`Failed to persist inbound message ${m.externalMessageId}: ${error}`);
          throw new ServiceUnavailableException('Could not persist inbound message');
        }
      } else {
        this.logger.warn(
          `No business found for ${channel} account=${m.externalAccountId}, skipping persistence`,
        );
      }

      // Dedup rápido en Redis (best-effort). Si Redis falla, la constraint
      // única (businessId, externalMessageId) en DB + el dedup del use case
      // siguen protegiendo contra doble procesamiento.
      // Namespace por canal para que el mismo ID externo en IG/Messenger no
      // colisione con el de WhatsApp.
      let isDuplicate = false;
      const dedupKey = `idempotency:${channel}:${m.externalAccountId}:${m.externalMessageId}`;
      try {
        const firstSeen = await this.redis.set(dedupKey, '1', 'EX', 86_400, 'NX');
        isDuplicate = !firstSeen;
      } catch (error) {
        this.logger.warn(`Redis dedup unavailable, relying on DB constraint: ${error}`);
      }
      if (isDuplicate) {
        this.logger.debug(`Duplicate webhook message ${m.externalMessageId}, skipping`);
        continue;
      }

      // BullMQ prohíbe ":" en custom jobIds (separador de keys de Redis).
      const jobId = `${channel}-${m.externalAccountId}-${m.externalMessageId}`;
      await this.inboundQueue.add(
        'process',
        {
          inboundMessageId: inboundId,
          channel,
          businessId: business?.id,
          externalAccountId: m.externalAccountId,
          customerPhone: m.from,
          text,
          externalMessageId: m.externalMessageId,
          rawPayload: m.rawPayload as Record<string, unknown>,
          customerName: m.customerName,
        },
        { jobId },
      );
      enqueuedCount += 1;
    }

    return { persistedCount, enqueuedCount };
  }
}
