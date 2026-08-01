import { Controller } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel } from '@core/domain/types';
import { InstagramAdapter } from './instagram.adapter';
import { MetaWebhookController } from '../meta/meta-webhook.controller';
import { ChannelWebhookService } from '../webhook/channel-webhook.service';

@Controller('webhook/instagram')
export class InstagramController extends MetaWebhookController {
  protected readonly channel: Channel = 'instagram';
  protected readonly adapter: InstagramAdapter;

  constructor(
    configService: ConfigService,
    instagram: InstagramAdapter,
    webhookService: ChannelWebhookService,
  ) {
    super(configService, webhookService);
    this.adapter = instagram;
  }
}
