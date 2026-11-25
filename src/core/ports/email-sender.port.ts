export interface EmailSendOptions {
  /** Dominio remitente configurado en EMAIL_DOMAINS_CONFIG (ej. "artagdev.com.co"). */
  fromDomain?: string;
  /** Dirección Reply-To opcional; por defecto usa el email remitente del dominio. */
  replyTo?: string;
}

export interface EmailSenderInfo {
  domain: string;
  defaultFrom: string;
  displayName?: string;
  isDefault: boolean;
}

/** Port para enviar emails transaccionales (hoy Resend; extensible). */
export interface EmailSenderPort {
  /**
   * Envía un email. Devuelve true si se envió, false si no hay provider
   * configurado (no rompe el flujo). Lanza si el provider falla.
   */
  send(to: string, subject: string, text: string, options?: EmailSendOptions): Promise<boolean>;

  /** Lista los remitentes/dominios disponibles sin exponer credenciales. */
  listSenders?(): EmailSenderInfo[];
}
