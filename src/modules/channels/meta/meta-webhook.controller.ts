import {
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
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { ChannelProviderPort } from '@core/ports/channel-provider.port';
import type { Channel } from '@core/domain/types';
import { ChannelWebhookService } from '../webhook/channel-webhook.service';

/**
 * Controller base de webhook para los canales de Meta (WhatsApp, Instagram,
 * Messenger). Cada subclase declara su ruta (@Controller) y su adapter; el
 * pipeline de verificación de firma + parseo + persist/enqueue es compartido.
 *
 * Patrón de herencia de NestJS: los handlers @Get/@Post del padre se registran
 * para cada subclase.
 */
export abstract class MetaWebhookController {
  protected abstract readonly channel: Channel;
  protected abstract readonly adapter: ChannelProviderPort;

  protected readonly verifyToken: string;
  protected readonly isProduction: boolean;
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    configService: ConfigService,
    protected readonly webhookService: ChannelWebhookService,
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
    this.logger.log(`Inbound webhook received (${this.channel})`);

    const rawBody = req.rawBody?.toString() ?? '';
    if (!rawBody) {
      throw new BadRequestException('Empty body');
    }

    if (!signature) {
      if (this.isProduction) {
        throw new UnauthorizedException('Missing x-hub-signature-256');
      }
      this.logger.warn('Missing x-hub-signature-256 header (dev mode — proceeding)');
    } else if (!this.adapter.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid JSON');
    }

    const messages = this.adapter.parseInboundWebhook(parsed);
    this.logger.log(`Parsed ${messages.length} message(s) from webhook`);

    const textMessages = messages.filter((m) => m.type === 'text');
    if (textMessages.length === 0) {
      this.logger.debug('No text messages to process');
      return { status: 'ok' };
    }

    const { persistedCount, enqueuedCount } = await this.webhookService.persistAndEnqueue(
      this.channel,
      textMessages,
    );

    this.logger.log(
      `Webhook processed ${textMessages.length} message(s): persisted=${persistedCount} enqueued=${enqueuedCount}`,
    );
    return { status: 'ok' };
  }
}
