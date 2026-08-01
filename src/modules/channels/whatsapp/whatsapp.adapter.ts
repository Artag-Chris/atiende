import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  ChannelProviderPort,
  ParsedInboundMessage,
  OutboundMessage,
  SendResult,
} from '@core/ports/channel-provider.port';
import type { ChannelAccountData } from '@core/ports/channel-account-repository.port';
import type { Channel } from '@core/domain/types';
import { CryptoService } from '@modules/infrastructure/encryption/crypto.service';

interface MetaWebhookChange {
  field: string;
  value: {
    messaging_product: string;
    metadata: { display_phone_number: string; phone_number_id: string };
    contacts?: Array<{ profile: { name: string }; wa_id: string }>;
    messages?: Array<{
      from: string;
      id: string;
      timestamp: string;
      type: string;
      text?: { body: string };
    }>;
  };
}

interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: MetaWebhookChange[];
  }>;
}

@Injectable()
export class WhatsAppAdapter implements ChannelProviderPort {
  readonly name: Channel = 'whatsapp';
  private readonly logger = new Logger(WhatsAppAdapter.name);
  private readonly appSecret: string;

  private readonly metaGraphApiVersion: string;
  private readonly graphApiTimeoutMs: number;
  private readonly devPhoneNumberId: string | undefined;
  private readonly devAccessToken: string | undefined;

  constructor(
    configService: ConfigService,
    private readonly crypto: CryptoService,
  ) {
    this.appSecret = configService.getOrThrow<string>('META_APP_SECRET');
    this.metaGraphApiVersion = configService.get<string>('META_GRAPH_API_VERSION', 'v21.0');
    this.graphApiTimeoutMs = configService.get<number>('META_GRAPH_API_TIMEOUT_MS', 15000);
    this.devPhoneNumberId = configService.get<string>('META_DEV_PHONE_NUMBER_ID');
    this.devAccessToken = configService.get<string>('META_DEV_ACCESS_TOKEN');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const expected = createHmac('sha256', this.appSecret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString())
      .digest('hex');
    const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }

  parseInboundWebhook(payload: unknown): ParsedInboundMessage[] {
    const body = payload as MetaWebhookPayload;

    const entries = body.entry ?? (Array.isArray(body) ? body : []);

    const messages: ParsedInboundMessage[] = [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value.messages || !value.metadata) continue;

        const contactsByName = new Map<string, string>();
        for (const contact of value.contacts ?? []) {
          if (contact.profile?.name) contactsByName.set(contact.wa_id, contact.profile.name);
        }

        for (const msg of value.messages) {
          messages.push({
            externalAccountId: value.metadata.phone_number_id,
            from: msg.from,
            externalMessageId: msg.id,
            type: msg.type === 'text' ? 'text' : 'unsupported',
            text: msg.text?.body,
            customerName: contactsByName.get(msg.from),
            timestamp: new Date(Number(msg.timestamp) * 1000),
            rawPayload: msg,
          });
        }
      }
    }

    return messages;
  }

  async send(message: OutboundMessage, account?: ChannelAccountData): Promise<SendResult> {
    const phoneId = account?.accountId ?? this.devPhoneNumberId;
    if (!phoneId) {
      throw new Error('META_DEV_PHONE_NUMBER_ID not configured');
    }
    const accessToken = await this.resolveToken(account);
    const url = `https://graph.facebook.com/${this.metaGraphApiVersion}/${phoneId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'text',
      text: { body: message.text },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.graphApiTimeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`WhatsApp send failed: ${response.status} ${error}`);
      throw new Error(`WhatsApp send failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };

    return {
      externalMessageId: data.messages?.[0]?.id ?? 'unknown',
      sentAt: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
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
    if (!this.devAccessToken) {
      throw new Error('META_DEV_ACCESS_TOKEN not configured');
    }
    return this.devAccessToken;
  }
}
