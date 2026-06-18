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
import { WhatsAppAdapter } from './whatsapp.adapter';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;

  constructor(
    configService: ConfigService,
    private readonly whatsapp: WhatsAppAdapter,
  ) {
    this.verifyToken = configService.getOrThrow<string>('META_WEBHOOK_VERIFY_TOKEN');
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
  handleInbound(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    this.logger.log('Inbound webhook received');

    const rawBody = req.rawBody?.toString() ?? '';
    if (!rawBody) {
      throw new BadRequestException('Empty body');
    }

    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header');
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

    for (const msg of messages) {
      this.logger.debug(`[${msg.externalMessageId}] from=${msg.from} text="${msg.text?.slice(0, 100)}"`);
    }

    return { status: 'ok' };
  }
}
