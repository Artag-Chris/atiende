import { Injectable } from '@nestjs/common';
import type { Channel } from '@core/domain/types';
import { MetaMessagingAdapter } from '../meta/meta-messaging.adapter';

/**
 * Messenger (Page) vía Messenger Platform.
 * Exige messaging_type en el body (RESPONSE para responder dentro de la
 * ventana de 24h; ID-based para mensajes fuera de ventana).
 */
@Injectable()
export class MessengerAdapter extends MetaMessagingAdapter {
  readonly name: Channel = 'messenger';
  protected readonly useMessagingType = true;
  protected readonly devAccountIdKey = 'META_DEV_PAGE_ID';
  protected readonly devTokenKey = 'META_DEV_PAGE_TOKEN';
}
