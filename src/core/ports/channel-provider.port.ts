/**
 * Port para canales de mensajería (WhatsApp, Web Chat, Telegram, ...).
 * Cada canal implementa esta interfaz desde src/modules/channels/<name>/.
 */

export interface InboundMessage {
  /** ID del business al que llegó el mensaje. */
  businessId: string;
  /** Identificador del remitente en el canal (ej: número de teléfono). */
  from: string;
  /** ID externo del mensaje en el canal (para idempotencia). */
  externalMessageId: string;
  /** Tipo de contenido. v1 solo soporta texto. */
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'unsupported';
  text?: string;
  /** Timestamp del mensaje según el canal. */
  timestamp: Date;
  /** Payload crudo para debug/replay. */
  rawPayload: unknown;
}

export interface OutboundMessage {
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
  readonly name: string;

  /** Envía un mensaje saliente al cliente final. */
  send(message: OutboundMessage): Promise<SendResult>;

  /**
   * Valida la firma de un webhook entrante. Cada provider tiene su mecanismo.
   * Devuelve true si la firma es válida.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;

  /**
   * Parsea el payload crudo de un webhook a InboundMessage[].
   * Un webhook puede traer múltiples mensajes.
   */
  parseInboundWebhook(payload: unknown): InboundMessage[];

  isHealthy(): Promise<boolean>;
}
