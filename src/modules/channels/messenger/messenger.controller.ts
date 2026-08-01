import { Controller } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel } from '@core/domain/types';
import { MessengerAdapter } from './messenger.adapter';
import { MetaWebhookController } from '../meta/meta-webhook.controller';
import { ChannelWebhookService } from '../webhook/channel-webhook.service';

@Controller('webhook/messenger')
export class MessengerController extends MetaWebhookController {
  protected readonly channel: Channel = 'messenger';
  protected readonly adapter: MessengerAdapter;

  constructor(
    configService: ConfigService,
    messenger: MessengerAdapter,
    webhookService: ChannelWebhookService,
  ) {
    super(configService, webhookService);
    this.adapter = messenger;
  }
}
