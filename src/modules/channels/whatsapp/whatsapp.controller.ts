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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { WhatsAppAdapter } from './whatsapp.adapter';
import { QUEUE_NAMES, type InboundMessageJobData } from '@config/queue.config';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;
  private readonly isProduction: boolean;

  constructor(
    configService: ConfigService,
    private readonly whatsapp: WhatsAppAdapter,
    @InjectQueue(QUEUE_NAMES.INBOUND_MESSAGE) private readonly inboundQueue: Queue<InboundMessageJobData>,
  ) {
    this.verifyToken = configService.getOrThrow<string>('META_WEBHOOK_VERIFY_TOKEN');
    this.isProduction = configService.get('NODE_ENV') === 'production';
  }

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

    const firstText = messages.find((m) => m.type === 'text' && m.text);
    if (!firstText || !firstText.text) {
      this.logger.debug('No text messages to process');
      return { status: 'ok' };
    }

    const jobId = `${firstText.externalAccountId}-${firstText.from}`;
    await this.inboundQueue.add(
      'process',
      {
        inboundMessageId: firstText.externalMessageId,
        businessId: firstText.externalAccountId,
        customerPhone: firstText.from,
        text: firstText.text,
        externalMessageId: firstText.externalMessageId,
        rawPayload: firstText.rawPayload as Record<string, unknown>,
      },
      { jobId },
    );

    this.logger.log(`Enqueued inbound message for ${firstText.from}`);
    return { status: 'ok' };
  }
}
