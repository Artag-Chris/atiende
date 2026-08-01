import { createHmac, timingSafeEqual } from 'crypto';
import type { ParsedInboundMessage } from '@core/ports/channel-provider.port';

/**
 * Shape del webhook de Messenger Platform (usado también por Instagram DM):
 *   {
 *     object: "page" | "instagram",
 *     entry: [{
 *       id: string,                // PAGE_ID o IG account id
 *       time: number,
 *       messaging: [{
 *         sender: { id: string },      // PSID o IGSID (cliente)
 *         recipient: { id: string },   // PAGE_ID o IGID (la cuenta del business)
 *         timestamp: number,           // epoch ms
 *         message?: {
 *           mid: string,
 *           text?: string,
 *           is_echo?: boolean,
 *           attachments?: Array<{ type: string }>
 *         }
 *       }]
 *     }]
 *   }
 *
 * Mismo host/endpoints que WhatsApp (graph.facebook.com) pero NUNCA
 * `entry[].changes[]` — ese es el shape de WhatsApp Business Cloud API.
 */

export interface MetaMessagingEntry {
  messaging?: Array<{
    sender: { id: string };
    recipient: { id: string };
    timestamp?: number;
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_self?: boolean;
      attachments?: Array<{ type: string }>;
    };
  }>;
}

export interface MetaMessagingPayload {
  object?: string;
  entry?: MetaMessagingEntry[];
}

export function parseMetaMessagingWebhook(payload: unknown): ParsedInboundMessage[] {
  const body = payload as MetaMessagingPayload;
  const entries = body.entry ?? (Array.isArray(body) ? body : []);

  const messages: ParsedInboundMessage[] = [];

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const recipientId = event.recipient?.id;
      const message = event.message;
      if (!senderId || !recipientId || !message?.mid) continue;

      // Echo de nuestros propios envíos o mensajes que envió el propio negocio
      // (app de IG/Messenger): no deben reprocesarse como entrantes.
      if (message.is_echo || message.is_self) continue;

      messages.push({
        externalAccountId: recipientId,
        from: senderId,
        externalMessageId: message.mid,
        type: message.text !== undefined && message.text !== null ? 'text' : 'unsupported',
        text: message.text,
        timestamp: new Date(event.timestamp ?? Date.now()),
        rawPayload: event,
      });
    }
  }

  return messages;
}

/**
 * Valida la firma HMAC-SHA256 del webhook (X-Hub-Signature-256).
 * Compartida por Instagram/Messenger/WhatsApp (mismo app secret de Meta).
 */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string | Buffer,
  signature: string,
): boolean {
  const expected = createHmac('sha256', appSecret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody.toString())
    .digest('hex');
  const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
