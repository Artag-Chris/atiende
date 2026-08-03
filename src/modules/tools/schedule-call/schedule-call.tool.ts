import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import { CALL_SCHEDULER_TOKEN, QUOTE_REPOSITORY_TOKEN } from '@core/tokens';
import type { CallSchedulerPort } from '@core/ports/call-scheduler.port';
import type { QuoteRepositoryPort } from '@core/ports/quote-repository.port';

const InputSchema = z.object({
  /** Preferencia de día/hora en lenguaje natural (ej: "mañana a las 3pm", "el lunes"). */
  preferredTime: z.string().min(1).max(200),
  /** Email del cliente (opcional; el agente lo pide si puede). */
  customerEmail: z.string().email().optional(),
  /** Notas/motivo de la llamada (opcional). */
  notes: z.string().max(500).optional(),
});

/**
 * Registra una solicitud de llamada/videollamada del cliente: guarda el lead en
 * DB (CallRequest) y notifica al equipo por email (Resend). Idempotente.
 * A futuro, un adapter Cal.com puede crear el evento real (mismo port).
 */
@Injectable()
export class ScheduleCallTool implements ToolModulePort {
  readonly name = 'schedule_call';
  readonly mutatesState = true; // persiste el CallRequest
  private readonly logger = new Logger(ScheduleCallTool.name);

  constructor(
    @Inject(CALL_SCHEDULER_TOKEN) private readonly scheduler: CallSchedulerPort,
    @Inject(QUOTE_REPOSITORY_TOKEN) private readonly quoteRepo: QuoteRepositoryPort,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Registra una solicitud de llamada o videollamada del cliente. Úsala cuando el cliente quiera agendar una llamada, videollamada o reunión ("¿me pueden llamar?", "quiero agendar una cita"). Captura el día/hora que el cliente prefiere y su email si lo da. El equipo contactará al cliente para confirmar.',
      inputSchema: {
        type: 'object',
        properties: {
          preferredTime: {
            type: 'string',
            description:
              'Día/hora que el cliente prefiere, en su idioma (ej: "mañana a las 3pm", "el lunes por la mañana", "hoy a las 5"). Si el cliente no da hora, usa "sin preferencia de horario".',
          },
          customerEmail: {
            type: 'string',
            description: 'Email del cliente si lo proporciona. Opcional.',
          },
          notes: {
            type: 'string',
            description: 'Motivo o tema de la llamada, si el cliente lo menciona. Opcional.',
          },
        },
        required: ['preferredTime'],
      },
    };
  }

  async execute(input: Record<string, unknown>, ctx: TurnContext): Promise<ToolExecutionResult> {
    const start = Date.now();

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        output:
          'No pude interpretar la solicitud de llamada. Por favor pide al cliente el día u horario que prefiere.',
        isError: true,
      };
    }
    const { preferredTime, customerEmail, notes } = parsed.data;

    try {
      // Si el cliente viene de una cotización, conectamos el lead con la última quote.
      const latestQuote = await this.quoteRepo
        .findLatestForCustomer(ctx.businessId, ctx.channel, ctx.customerPhone)
        .catch(() => null);

      const result = await this.scheduler.requestCall({
        businessId: ctx.businessId,
        conversationId: ctx.conversationId,
        customerIdentifier: ctx.customerPhone,
        channel: ctx.channel,
        preferredTime,
        customerEmail,
        notes,
        quoteId: latestQuote?.id,
      });

      return {
        output: JSON.stringify(
          {
            callRequestId: result.id,
            status: result.status,
            message:
              'Hemos registrado tu solicitud de llamada. El equipo te contactará pronto para confirmar el horario.',
          },
          null,
          2,
        ),
        meta: { latencyMs: Date.now() - start },
      };
    } catch (error) {
      this.logger.error(`schedule_call failed: ${error}`);
      return { output: 'No se pudo registrar la solicitud de llamada.', isError: true };
    }
  }
}
