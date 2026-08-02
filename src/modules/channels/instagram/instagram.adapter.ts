import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Channel } from '@core/domain/types';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import { MetaMessagingAdapter } from '../meta/meta-messaging.adapter';

/**
 * Instagram DM vía la API de Instagram (graph.instagram.com).
 * El envío usa el endpoint /me/messages con el IG Access Token (IGAA...),
 * NO la Messenger Platform de graph.facebook.com (que devuelve #3 para IG).
 */
@Injectable()
export class InstagramAdapter extends MetaMessagingAdapter {
  readonly name: Channel = 'instagram';
  protected readonly useMessagingType = false;
  protected readonly devAccountIdKey = 'META_DEV_IG_ID';
  protected readonly devTokenKey = 'META_DEV_IG_TOKEN';
  private readonly igGraphApiVersion: string;

  constructor(configService: ConfigService, crypto: CryptoService) {
    // Instagram puede tener SU PROPIA app de Meta (secret distinto al de WhatsApp).
    super(configService, crypto, 'META_INSTAGRAM_APP_SECRET');
    this.igGraphApiVersion = configService.get<string>('META_INSTAGRAM_GRAPH_API_VERSION', 'v25.0');
  }

  protected buildSendEndpoint(_accountId: string): string {
    return `https://graph.instagram.com/${this.igGraphApiVersion}/me/messages`;
  }
}
