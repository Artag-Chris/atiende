import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChannelProviderPort,
  ParsedInboundMessage,
  OutboundMessage,
  SendResult,
} from '@core/ports/channel-provider.port';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';
import type { Channel } from '@core/domain/types';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';
import { parseMetaMessagingWebhook, verifyMetaSignature } from './meta-webhook.parser';

/**
 * Base común de los adapters de la Messenger Platform (Instagram DM y
 * Messenger/Page). Ambos comparten:
 *  - Host: graph.facebook.com (NUNCA graph.instagram.com — ese host requiere
 *    Instagram Login y no sirve para bots).
 *  - Envío: POST /{v}/{IG_ID|PAGE_ID}/messages con Page Access Token.
 *  - Webhook entrante: shape entry[].messaging[] (parseado en meta-webhook.parser).
 *
 * Subclases: InstagramAdapter (sin messaging_type, el token se resuelve por IG ID)
 * y MessengerAdapter (exige messaging_type: RESPONSE).
 */
@Injectable()
export abstract class MetaMessagingAdapter implements ChannelProviderPort {
  abstract readonly name: Channel;
  /** Messenger exige messaging_type en el body; Instagram lo ignora. */
  protected abstract readonly useMessagingType: boolean;
  /** Env var con el accountId dev (IG_ID o PAGE_ID) para single-tenant. */
  protected abstract readonly devAccountIdKey: string;
  /** Env var con el token dev (IG_TOKEN o PAGE_TOKEN). */
  protected abstract readonly devTokenKey: string;

  protected readonly appSecret: string;
  protected readonly graphVersion: string;
  protected readonly timeoutMs: number;
  private readonly logger = new Logger(MetaMessagingAdapter.name);

  constructor(
    protected readonly config: ConfigService,
    protected readonly crypto: CryptoService,
    /** Env var del App Secret de Meta para ESTE canal (META_APP_SECRET si comparte la app). */
    appSecretKey: string = 'META_APP_SECRET',
  ) {
    // Secret por canal: si el canal tiene su propia app de Meta, su propio secret.
    // Fallback al genérico (misma app para todos los canales).
    this.appSecret =
      config.get<string>(appSecretKey) ?? config.getOrThrow<string>('META_APP_SECRET');
    this.graphVersion = config.get<string>('META_GRAPH_API_VERSION', 'v21.0');
    this.timeoutMs = config.get<number>('META_GRAPH_API_TIMEOUT_MS', 15000);
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyMetaSignature(this.appSecret, rawBody, signature);
  }

  parseInboundWebhook(payload: unknown): ParsedInboundMessage[] {
    return parseMetaMessagingWebhook(payload);
  }

  async send(message: OutboundMessage, account?: ChannelAccountData): Promise<SendResult> {
    const accountId = account?.accountId ?? this.config.get<string>(this.devAccountIdKey);
    if (!accountId) {
      throw new Error(`${this.devAccountIdKey} not configured`);
    }
    const accessToken = await this.resolveToken(account);
    const url = this.buildSendEndpoint(accountId);

    const body: Record<string, unknown> = {
      recipient: { id: message.to },
      message: { text: message.text },
    };
    if (this.useMessagingType) {
      body.messaging_type = 'RESPONSE';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`${this.name} send failed: ${response.status} ${error}`);
      throw new Error(`${this.name} send failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      message_id?: string;
      recipient_id?: string;
    };

    return {
      externalMessageId: data.message_id ?? 'unknown',
      sentAt: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  /**
   * Endpoint de envío por canal. Default: Messenger Platform (Page).
   * Instagram lo sobreescribe a graph.instagram.com/me/messages.
   */
  protected buildSendEndpoint(_accountId: string): string {
    return `https://graph.facebook.com/${this.graphVersion}/${_accountId}/messages`;
  }

  private async resolveToken(account?: ChannelAccountData): Promise<string> {
    if (account) {
      try {
        return this.crypto.decrypt(account.tokenEncrypted);
      } catch (error) {
        this.logger.warn(
          `Failed to decrypt token for account ${account.id}, falling back to dev token: ${error}`,
        );
      }
    }
    const dev = this.config.get<string>(this.devTokenKey);
    if (!dev) {
      throw new Error(`${this.devTokenKey} not configured`);
    }
    return dev;
  }
}
