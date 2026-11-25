import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  EmailSenderInfo,
  EmailSenderPort,
  EmailSendOptions,
} from '@core/ports/email-sender.port';

/** Estructura de una entrada de EMAIL_DOMAINS_CONFIG (Resend multi-dominio). */
export interface EmailDomainConfig {
  domain: string;
  apiKey: string;
  webhookSecret?: string;
  defaultFrom: string;
  displayName?: string;
}

export class UnknownEmailDomainError extends Error {
  constructor(public readonly domain: string) {
    super(`Email domain not configured: ${domain}`);
    this.name = 'UnknownEmailDomainError';
  }
}

const DEFAULT_DOMAIN = 'artagdev.com.co';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 12px 0;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#18181b;">${paragraphs}</div>`;
}

function extractEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim();
}

/**
 * Envía emails transaccionales vía la API de Resend (fetch directo).
 *
 * Resuelve credenciales desde EMAIL_DOMAINS_CONFIG (JSON array de dominios),
 * usando EMAIL_DEFAULT_DOMAIN (default artagdev.com.co) o el dominio indicado
 * en options.fromDomain. Mantiene fallback a RESEND_API_KEY / NOTIFICATIONS_FROM_EMAIL.
 */
@Injectable()
export class ResendEmailService implements EmailSenderPort {
  private readonly logger = new Logger(ResendEmailService.name);
  private readonly domains: EmailDomainConfig[];
  private readonly defaultDomainName: string;
  private readonly fallbackApiKey: string | undefined;
  private readonly fallbackFrom: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.domains = this.parseDomainsConfig();
    this.defaultDomainName = (
      this.config.get<string>('EMAIL_DEFAULT_DOMAIN') ?? DEFAULT_DOMAIN
    )
      .trim()
      .toLowerCase();
    this.fallbackApiKey = this.config.get<string>('RESEND_API_KEY');
    this.fallbackFrom = this.config.get<string>('NOTIFICATIONS_FROM_EMAIL');
  }

  listSenders(): EmailSenderInfo[] {
    if (this.domains.length > 0) {
      const def = this.resolveDefaultDomain();
      return this.domains.map((d) => ({
        domain: d.domain,
        defaultFrom: d.defaultFrom,
        displayName: d.displayName,
        isDefault: d.domain.toLowerCase() === def?.domain.toLowerCase(),
      }));
    }

    if (this.fallbackApiKey && this.fallbackFrom) {
      const addr = extractEmailAddress(this.fallbackFrom);
      const domain = addr.includes('@') ? addr.split('@')[1].toLowerCase() : 'default';
      return [
        {
          domain,
          defaultFrom: this.fallbackFrom,
          isDefault: true,
        },
      ];
    }

    return [];
  }

  async send(
    to: string,
    subject: string,
    text: string,
    options?: EmailSendOptions,
  ): Promise<boolean> {
    const resolved = this.resolveSender(options?.fromDomain);
    if (!resolved) {
      this.logger.warn(
        'Resend not configured (EMAIL_DOMAINS_CONFIG / RESEND_API_KEY) — skipping email',
      );
      return false;
    }

    const replyTo = options?.replyTo?.trim() || extractEmailAddress(resolved.from);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify({
          from: resolved.from,
          to: [to],
          reply_to: replyTo,
          subject,
          text,
          html: textToHtml(text),
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

  private resolveSender(requestedDomain?: string): { apiKey: string; from: string } | undefined {
    const normalized = requestedDomain?.trim().toLowerCase();

    if (normalized) {
      if (this.domains.length > 0) {
        const match = this.domains.find((d) => d.domain.toLowerCase() === normalized);
        if (!match) throw new UnknownEmailDomainError(normalized);
        return { apiKey: match.apiKey, from: match.defaultFrom };
      }

      if (this.fallbackApiKey && this.fallbackFrom) {
        const fallbackDomain = extractEmailAddress(this.fallbackFrom).split('@')[1]?.toLowerCase();
        if (fallbackDomain === normalized) {
          return { apiKey: this.fallbackApiKey, from: this.fallbackFrom };
        }
        throw new UnknownEmailDomainError(normalized);
      }

      return undefined;
    }

    const def = this.resolveDefaultDomain();
    if (def) {
      return { apiKey: def.apiKey, from: def.defaultFrom };
    }

    if (this.fallbackApiKey && this.fallbackFrom) {
      return { apiKey: this.fallbackApiKey, from: this.fallbackFrom };
    }

    return undefined;
  }

  private resolveDefaultDomain(): EmailDomainConfig | undefined {
    if (this.domains.length === 0) return undefined;
    return (
      this.domains.find((d) => d.domain.toLowerCase() === this.defaultDomainName) ??
      this.domains[0]
    );
  }

  private parseDomainsConfig(): EmailDomainConfig[] {
    const raw = this.config.get<string>('EMAIL_DOMAINS_CONFIG');
    if (!raw) return [];
    try {
      const domains = JSON.parse(raw) as EmailDomainConfig[];
      if (!Array.isArray(domains)) return [];
      return domains.filter((d) => Boolean(d?.domain && d?.apiKey && d?.defaultFrom));
    } catch (error) {
      this.logger.warn(`EMAIL_DOMAINS_CONFIG is not valid JSON: ${error}`);
      return [];
    }
  }
}
