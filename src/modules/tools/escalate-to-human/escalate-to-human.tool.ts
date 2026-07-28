import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';

const InputSchema = z.object({
  reason: z.string().min(1).max(500),
  urgency: z.enum(['low', 'medium', 'high']).default('medium'),
});

@Injectable()
export class EscalateToHumanTool implements ToolModulePort {
  readonly name = 'escalate_to_human';
  readonly mutatesState = true;
  private readonly logger = new Logger(EscalateToHumanTool.name);

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Escala la conversación a un humano del equipo del negocio. Úsala cuando: el cliente pide hablar con una persona real, tiene una queja o reclamo, necesita soporte técnico especializado, o cuando no puedes resolver su consulta con las herramientas disponibles.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Razón del escalamiento para que el equipo humano entienda el contexto.',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'Nivel de urgencia del escalamiento.',
          },
        },
        required: ['reason'],
      },
    };
  }

  async execute(input: Record<string, unknown>, ctx: TurnContext): Promise<ToolExecutionResult> {
    const start = Date.now();

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        output: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        isError: true,
      };
    }
    const { reason, urgency } = parsed.data;

    this.logger.log(
      `[Escalation] Business=${ctx.businessId} Conv=${ctx.conversationId} Urgency=${urgency} Reason: ${reason}`,
    );

    return {
      output: JSON.stringify({
        status: 'escalated',
        message:
          'Tu solicitud ha sido escalada a nuestro equipo. Un representante te contactará pronto. Mientras tanto, ¿hay algo más que pueda ayudarte?',
        reason,
        urgency,
      }),
      meta: { latencyMs: Date.now() - start },
    };
  }
}
