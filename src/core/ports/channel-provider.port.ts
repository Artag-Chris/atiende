import type { Channel } from '../domain/types';
import type { ChannelAccountData } from './channel-account-repository.port';

/**
 * Port para canales de mensajería (WhatsApp, Web Chat, Telegram, ...).
 * Cada canal implementa esta interfaz desde src/modules/channels/<name>/.
 *
 * Diseño:
 *   - parseInboundWebhook() es PURO: no toca DB, devuelve datos crudos del webhook.
 *     El service consumidor resuelve businessId luego (lookup por phone_number_id).
 *   - send() es async: hace la llamada HTTP al provider real.
 *   - verifyWebhookSignature() es sync: HMAC sobre el raw body.
 */

/**
 * Mensaje entrante parseado desde un webhook, ANTES de resolver el business.
 * El consumer (WebhookController) hace la lookup por externalAccountId.
 */
export interface ParsedInboundMessage {
  /**
   * Identificador del cuenta destino en el canal (ej: phone_number_id de WhatsApp,
   * chat_id de Telegram). Usado por el service para encontrar el Business correspondiente.
   */
  externalAccountId: string;
  /** Identificador del remitente en el canal (ej: número de teléfono). */
  from: string;
  /** ID externo del mensaje en el canal (para idempotencia). */
  externalMessageId: string;
  /** Tipo de contenido. v1 solo soporta texto. */
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'unsupported';
  text?: string;
  /** Nombre del remitente según el canal (ej: profile.name de WhatsApp). Opcional. */
  customerName?: string;
  /** Timestamp del mensaje según el canal. */
  timestamp: Date;
  /** Payload crudo para debug/replay. */
  rawPayload: unknown;
}

export interface OutboundMessage {
  /** El business desde donde se envía (para resolver credenciales encriptadas en DB). */
  businessId: string;
  to: string;
  text: string;
}

export interface SendResult {
  externalMessageId: string;
  sentAt: Date;
}

/**
 * Port del canal. El core no sabe que existe WhatsApp.
 */
export interface ChannelProviderPort {
  readonly name: Channel;

  /**
   * Envía un mensaje saliente al cliente final.
   * @param account cuenta del business en el canal (resuelta por el router).
   *                Si es undefined, el adapter usa la credencial dev single-tenant.
   */
  send(message: OutboundMessage, account?: ChannelAccountData): Promise<SendResult>;

  /**
   * Valida la firma HMAC del webhook entrante.
   * @param rawBody  body crudo, sin parsear (necesario para que el hash coincida)
   * @param signature header de firma (ej: X-Hub-Signature-256 en WhatsApp)
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;

  /**
   * Parsea el payload crudo de un webhook a ParsedInboundMessage[].
   * Es PURO (no toca DB). Un webhook puede traer múltiples mensajes.
   */
  parseInboundWebhook(payload: unknown): ParsedInboundMessage[];

  isHealthy(): Promise<boolean>;
}
