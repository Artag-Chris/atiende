import {
  Controller,
  Get,
  Post,
  Query,
  Headers,
  RawBodyRequest,
  Req,
  Logger,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { META_WEBHOOK_VERIFY_TOKEN } from '../../../core/tokens';
import type { Env } from '../../../config/env';
import { ENV_TOKEN } from '../../../core/tokens';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    this.logger.log(`Webhook verify request: mode=${mode}`);

    if (mode === 'subscribe' && token === this.env.META_WEBHOOK_VERIFY_TOKEN) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed — token mismatch');
    throw new Error('Verification failed');
  }

  @Post()
  handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.logger.log('Inbound webhook received');

    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header');
    }

    const rawBody = req.rawBody?.toString() ?? '';
    this.logger.debug(`Raw body: ${rawBody.slice(0, 500)}`);

    return { status: 'ok' };
  }
}
