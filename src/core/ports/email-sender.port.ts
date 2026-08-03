/** Port para enviar emails transaccionales (hoy Resend; extensible). */
export interface EmailSenderPort {
  /**
   * Envía un email. Devuelve true si se envió, false si no hay provider
   * configurado (no rompe el flujo). Lanza si el provider falla.
   */
  send(to: string, subject: string, text: string): Promise<boolean>;
}
