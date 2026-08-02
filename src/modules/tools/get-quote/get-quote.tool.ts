import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import { QUOTE_REPOSITORY_TOKEN } from '@core/tokens';
import type { QuoteRepositoryPort } from '@core/ports/quote-repository.port';

const InputSchema = z.object({
  quoteId: z.string().optional(),
});

/**
 * Recupera la cotización más reciente del cliente (identidad por canal: solo
 * el mismo (channel, customerIdentifier) ve sus cotizaciones). Permite que el
 * cliente pregunte "¿cuál fue mi cotización?" después de una estimate_price.
 */
@Injectable()
export class GetQuoteTool implements ToolModulePort {
  readonly name = 'get_quote';
  readonly mutatesState = false; // solo lectura
  private readonly logger = new Logger(GetQuoteTool.name);

  constructor(
    @Inject(QUOTE_REPOSITORY_TOKEN)
    private readonly quoteRepo: QuoteRepositoryPort,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Recupera la cotización que el cliente pidió anteriormente. Úsala cuando el cliente pregunte "¿cuál fue mi cotización?", "cuánto me cotizaste", o quiera ver su presupuesto previo.',
      inputSchema: {
        type: 'object',
        properties: {
          quoteId: {
            type: 'string',
            description: 'ID de la cotización (opcional; si no se da, se devuelve la más reciente)',
          },
        },
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
    const { quoteId } = parsed.data;

    try {
      const quote = quoteId
        ? await this.quoteRepo.findByIdForCustomer(
            quoteId,
            ctx.businessId,
            ctx.channel,
            ctx.customerPhone,
          )
        : await this.quoteRepo.findLatestForCustomer(
            ctx.businessId,
            ctx.channel,
            ctx.customerPhone,
          );

      if (!quote) {
        return {
          output: JSON.stringify({
            message: 'Aún no tienes una cotización registrada. ¿Quieres que te arme una?',
          }),
        };
      }

      return {
        output: JSON.stringify(
          {
            quoteId: quote.id,
            total: quote.totalDisplay,
            currency: quote.currency,
            status: quote.status,
            createdAt: quote.createdAt.toISOString(),
            services: quote.services,
            infrastructure: quote.infrastructure,
          },
          null,
          2,
        ),
        meta: { latencyMs: Date.now() - start },
      };
    } catch (error) {
      this.logger.error(`get_quote failed: ${error}`);
      return { output: 'Error al recuperar la cotización.', isError: true };
    }
  }
}
