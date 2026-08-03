import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailSenderPort } from '@core/ports/email-sender.port';

/** Estructura de una entrada de EMAIL_DOMAINS_CONFIG (Resend multi-dominio). */
export interface EmailDomainConfig {
  domain: string;
  apiKey: string;
  webhookSecret?: string;
  defaultFrom: string;
  displayName?: string;
}

const LUMEN_DOMAIN = 'lumenxlabs.com.co';

/**
 * Envía emails transaccionales vía la API de Resend (fetch directo).
 *
 * Resuelve la credencial desde EMAIL_DOMAINS_CONFIG (JSON array de dominios),
 * usando el dominio de LumenX (lumenxlabs.com.co). Fallback a las env viejas
 * (RESEND_API_KEY / NOTIFICATIONS_FROM_EMAIL) por compatibilidad.
 *
 * Reutilizable a futuro: recordatorios de Cal.com, notificaciones de
 * escalación, etc.
 */
@Injectable()
export class ResendEmailService implements EmailSenderPort {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly apiKey: string | undefined;
  private readonly from: string | undefined;

  constructor(private readonly config: ConfigService) {
    const resolved = this.resolveLumenConfig();
    this.apiKey = resolved?.apiKey ?? this.config.get<string>('RESEND_API_KEY');
    this.from = resolved?.defaultFrom ?? this.config.get<string>('NOTIFICATIONS_FROM_EMAIL');
  }

  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.apiKey || !this.from) {
      this.logger.warn(
        'Resend not configured (EMAIL_DOMAINS_CONFIG / RESEND_API_KEY) — skipping email',
      );
      return false;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject,
          text,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Resend HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`Resend send failed: ${error}`);
      throw error;
    }
  }

  /** Busca el dominio de LumenX en EMAIL_DOMAINS_CONFIG (o el primero si no está). */
  private resolveLumenConfig(): EmailDomainConfig | undefined {
    const raw = this.config.get<string>('EMAIL_DOMAINS_CONFIG');
    if (!raw) return undefined;
    try {
      const domains = JSON.parse(raw) as EmailDomainConfig[];
      if (!Array.isArray(domains) || domains.length === 0) return undefined;
      return (
        domains.find((d) => d.domain === LUMEN_DOMAIN) ??
        domains.find((d) => d.domain.includes('lumen')) ??
        domains[0]
      );
    } catch (error) {
      this.logger.warn(`EMAIL_DOMAINS_CONFIG is not valid JSON: ${error}`);
      return undefined;
    }
  }
}
