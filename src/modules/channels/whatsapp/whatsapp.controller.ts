import {
  Controller,
  Get,
  Post,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { QUEUE_NAMES, type InboundMessageJobData } from '@config/queue.config';
import {
  BUSINESS_REPOSITORY_TOKEN,
  INBOUND_MESSAGE_REPOSITORY_TOKEN,
  REDIS_CLIENT_TOKEN,
} from '@core/tokens';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import type { InboundMessageRepositoryPort } from '@core/ports/inbound-message-repository.port';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;
  private readonly isProduction: boolean;

  constructor(
    configService: ConfigService,
    private readonly whatsapp: WhatsAppAdapter,
    @InjectQueue(QUEUE_NAMES.INBOUND_MESSAGE)
    private readonly inboundQueue: Queue<InboundMessageJobData>,
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: Redis,
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
    @Inject(INBOUND_MESSAGE_REPOSITORY_TOKEN)
    private readonly inboundRepo: InboundMessageRepositoryPort,
  ) {
    this.verifyToken = configService.getOrThrow<string>('META_WEBHOOK_VERIFY_TOKEN');
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

  @SkipThrottle()
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    this.logger.log(`Webhook verify request: mode=${mode}`);

    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed — token mismatch');
    throw new UnauthorizedException('Verification failed');
  }

  @Post()
  async handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.logger.log('Inbound webhook received');

    const rawBody = req.rawBody?.toString() ?? '';
    if (!rawBody) {
      throw new BadRequestException('Empty body');
    }

    if (!signature) {
      if (this.isProduction) {
        throw new UnauthorizedException('Missing x-hub-signature-256');
      }
      this.logger.warn('Missing x-hub-signature-256 header (dev mode — proceeding)');
    } else if (!this.whatsapp.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    const messages = this.whatsapp.parseInboundWebhook(parsed);
    this.logger.log(`Parsed ${messages.length} message(s) from webhook`);

    const textMessages = messages.filter((m) => m.type === 'text');
    if (textMessages.length === 0) {
      this.logger.debug('No text messages to process');
      return { status: 'ok' };
    }

    let persistedCount = 0;
    let enqueuedCount = 0;

    for (const m of textMessages) {
      const text = m.text;
      if (!text) continue;

      // NFR-8 zero-loss: persiste el mensaje ANTES de encolar. Si el enqueue
      // falla (Redis/BullMQ caídos), Meta reintenta el webhook y el dedup por
      // constraint único en DB evita duplicados — nada se pierde.
      let inboundId: string | undefined;
      const business = await this.businessRepo.findByChannelAccount(
        'whatsapp',
        m.externalAccountId,
      );
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
          `No business found for phone_id=${m.externalAccountId}, skipping persistence`,
        );
      }

      // Dedup rápido en Redis (best-effort). Si Redis falla, la constraint
      // única (businessId, externalMessageId) en DB + el dedup del use case
      // siguen protegiendo contra doble procesamiento.
      // Namespace por canal para que el mismo ID externo en IG/Messenger no
      // colisione con el de WhatsApp.
      let isDuplicate = false;
      const dedupKey = `idempotency:whatsapp:${m.externalAccountId}:${m.externalMessageId}`;
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

      const jobId = `whatsapp:${m.externalAccountId}-${m.externalMessageId}`;
      await this.inboundQueue.add(
        'process',
        {
          inboundMessageId: inboundId,
          channel: 'whatsapp',
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

    this.logger.log(
      `Webhook processed ${textMessages.length} message(s): persisted=${persistedCount} enqueued=${enqueuedCount}`,
    );
    return { status: 'ok' };
  }
}
