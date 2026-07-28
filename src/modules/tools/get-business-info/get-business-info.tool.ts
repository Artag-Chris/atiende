import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import { BUSINESS_REPOSITORY_TOKEN } from '@core/tokens';

const InputSchema = z.object({
  topic: z.string().min(1).max(100),
});

@Injectable()
export class GetBusinessInfoTool implements ToolModulePort {
  readonly name = 'get_business_info';
  readonly mutatesState = false;
  private readonly logger = new Logger(GetBusinessInfoTool.name);

  constructor(
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Obtiene información del negocio como horarios, ubicación, servicios, website y configuración general. Úsala cuando el cliente pregunte por el negocio, sus horarios, dónde está, qué hace, o información general.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              'Tema sobre el que quiere información (ej: "horarios", "ubicación", "servicios", "general")',
          },
        },
        required: ['topic'],
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
    const { topic } = parsed.data;

    try {
      const business = await this.businessRepo.findById(ctx.businessId);
      if (!business) {
        return { output: 'No se encontró información del negocio.', isError: true };
      }

      const settings = business.settings as Record<string, unknown>;
      const info: Record<string, unknown> = {
        name: business.name,
        website: settings.website,
        business_hours: settings.business_hours,
        location: settings.location,
        language: settings.language,
      };

      if (topic !== 'general') {
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(info)) {
          if (
            key.toLowerCase().includes(topic.toLowerCase()) ||
            (typeof value === 'string' && value.toLowerCase().includes(topic.toLowerCase()))
          ) {
            filtered[key] = value;
          }
        }
        if (Object.keys(filtered).length === 0) {
          return {
            output: `No se encontró información específica sobre "${topic}". Info disponible: horarios, ubicación, servicios, website.`,
          };
        }
        return {
          output: JSON.stringify(filtered, null, 2),
          meta: { latencyMs: Date.now() - start },
        };
      }

      return {
        output: JSON.stringify(info, null, 2),
        meta: { latencyMs: Date.now() - start },
      };
    } catch (error) {
      this.logger.error(`get_business_info failed: ${error}`);
      return { output: 'Error al obtener información del negocio.', isError: true };
    }
  }
}
