import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { ChannelProviderPort, ParsedInboundMessage, OutboundMessage, SendResult } from '@core/ports/channel-provider.port';
import type { Channel } from '@core/domain/types';

interface MetaWebhookEntry {
  id: string;
  changes: Array<{
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
  }>;
}

@Injectable()
export class WhatsAppAdapter implements ChannelProviderPort {
  readonly name: Channel = 'whatsapp';
  private readonly logger = new Logger(WhatsAppAdapter.name);
  private readonly appSecret: string;

  constructor(configService: ConfigService) {
    this.appSecret = configService.getOrThrow<string>('META_APP_SECRET');
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const expected = createHmac('sha256', this.appSecret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString())
      .digest('hex');
    const received = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;
    return expected === received;
  }

  parseInboundWebhook(payload: unknown): ParsedInboundMessage[] {
    const body = payload as MetaWebhookEntry;
    const entries = Array.isArray(body) ? body : [body];

    const messages: ParsedInboundMessage[] = [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value.messages) continue;

        for (const msg of value.messages) {
          messages.push({
            externalAccountId: value.metadata.phone_number_id,
            from: msg.from,
            externalMessageId: msg.id,
            type: msg.type === 'text' ? 'text' : 'unsupported',
            text: msg.text?.body,
            timestamp: new Date(Number(msg.timestamp) * 1000),
            rawPayload: msg,
          });
        }
      }
    }

    return messages;
  }

  async send(_message: OutboundMessage): Promise<SendResult> {
    this.logger.warn('WhatsApp send not yet implemented — week 2');
    return {
      externalMessageId: 'mock',
      sentAt: new Date(),
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
