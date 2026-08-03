import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { CALL_REQUEST_REPOSITORY_TOKEN, EMAIL_SENDER_TOKEN } from '@core/tokens';
import type { CallRequestRepositoryPort } from '@core/ports/call-request-repository.port';
import type {
  CallSchedulerPort,
  CallSchedulerInput,
  CallSchedulerResult,
} from '@core/ports/call-scheduler.port';
import type { EmailSenderPort } from '@core/ports/email-sender.port';

/**
 * Adapter de agendamiento (Opción A): persiste el CallRequest como lead y
 * notifica al equipo por email (Resend). Si el email falla, el lead igual se
 * guarda (no se pierde). A futuro, un CalComCallScheduler puede reemplazarlo
 * sin cambiar el core (mismo CallSchedulerPort).
 */
@Injectable()
export class EmailCallScheduler implements CallSchedulerPort {
  private readonly logger = new Logger(EmailCallScheduler.name);
  private readonly notifyEmail: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(CALL_REQUEST_REPOSITORY_TOKEN)
    private readonly repo: CallRequestRepositoryPort,
    @Inject(EMAIL_SENDER_TOKEN)
    private readonly email: EmailSenderPort,
  ) {
    this.notifyEmail =
      this.config.get<string>('SCHEDULING_NOTIFY_EMAIL') ??
      this.config.get<string>('NOTIFICATIONS_FROM_EMAIL') ??
      '';
  }

  async requestCall(input: CallSchedulerInput): Promise<CallSchedulerResult> {
    const dedupKey = this.buildDedupKey(input);
    const saved = await this.repo.save({
      ...input,
      dedupKey,
    });

    // El lead ya está guardado; el email es best-effort (no debe romper el flujo).
    if (this.notifyEmail) {
      try {
        const subject = `Nueva solicitud de llamada — ${input.customerIdentifier}`;
        const body = [
          `Canal: ${input.channel}`,
          `Cliente: ${input.customerIdentifier}${input.customerEmail ? ` (${input.customerEmail})` : ''}`,
          `Horario preferido: ${input.preferredTime}`,
          input.notes ? `Notas: ${input.notes}` : '',
          input.quoteId ? `Cotización asociada: ${input.quoteId}` : '',
          `Conversación: ${input.conversationId}`,
        ]
          .filter(Boolean)
          .join('\n');
        await this.email.send(this.notifyEmail, subject, body);
      } catch (error) {
        this.logger.warn(`Failed to notify team about call request ${saved.id}: ${error}`);
      }
    } else {
      this.logger.warn('SCHEDULING_NOTIFY_EMAIL not set — call request saved without email');
    }

    return { id: saved.id, status: saved.status };
  }

  /** Hash canónico para idempotencia (mismo cliente+conversación+horario). */
  private buildDedupKey(input: CallSchedulerInput): string {
    const canonical = JSON.stringify({
      channel: input.channel,
      customer: input.customerIdentifier,
      conversation: input.conversationId,
      preferredTime: input.preferredTime.trim().toLowerCase(),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }
}
