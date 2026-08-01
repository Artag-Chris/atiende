import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel } from '@core/domain/types';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import { MetaMessagingAdapter } from '../meta/meta-messaging.adapter';

/**
 * Instagram DM vía Messenger Platform.
 * El IG_ID del business es el `recipient.id` en los webhooks y el sender del
 * POST /{IG_ID}/messages. El Page Access Token del IG business resuelve ambos
 * (object: instagram en el webhook).
 */
@Injectable()
export class InstagramAdapter extends MetaMessagingAdapter {
  readonly name: Channel = 'instagram';
  protected readonly useMessagingType = false;
  protected readonly devAccountIdKey = 'META_DEV_IG_ID';
  protected readonly devTokenKey = 'META_DEV_IG_TOKEN';

  constructor(configService: ConfigService, crypto: CryptoService) {
    // Instagram puede tener SU PROPIA app de Meta (secret distinto al de WhatsApp).
    super(configService, crypto, 'META_INSTAGRAM_APP_SECRET');
  }
}
