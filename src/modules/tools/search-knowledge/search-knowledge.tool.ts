import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import { KnowledgeService } from '@modules/knowledge/knowledge.service';

const InputSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(10).default(5),
  kind: z.enum(['FAQ', 'POLICY', 'PDF_CATALOG', 'MANUAL', 'NOTES', 'OTHER']).optional(),
});

@Injectable()
export class SearchKnowledgeTool implements ToolModulePort {
  readonly name = 'search_knowledge';
  readonly mutatesState = false;
  private readonly logger = new Logger(SearchKnowledgeTool.name);

  constructor(private readonly knowledgeService: KnowledgeService) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Busca información en documentos de conocimiento del negocio (FAQs, políticas, manuales, catálogos PDF). Úsala cuando el cliente pregunte por garantías, políticas de devolución, horarios, métodos de pago, instrucciones de uso, o cualquier información que no esté en el catálogo de productos.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Consulta del cliente (ej: "política de devolución", "cómo activar garantía", "horarios")',
          },
          limit: {
            type: 'number',
            description: 'Número máximo de resultados (default: 5)',
          },
          kind: {
            type: 'string',
            enum: ['FAQ', 'POLICY', 'PDF_CATALOG', 'MANUAL', 'NOTES', 'OTHER'],
            description: 'Filtrar por tipo de documento (opcional)',
          },
        },
        required: ['query'],
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
    const { query, limit, kind } = parsed.data;

    try {
      const results = await this.knowledgeService.search(ctx.businessId, query, { limit, kind });

      if (results.length === 0) {
        return {
          output: JSON.stringify({
            message: 'No se encontró información relevante en los documentos de conocimiento.',
            query,
          }),
        };
      }

      const chunks = results.map((r) => ({
        text: r.chunk.text,
        documentId: r.chunk.documentId,
        position: r.chunk.position,
        pageNumber: r.chunk.pageNumber,
        kind: r.chunk.kind,
        similarity: Math.round(r.similarity * 100) + '%',
      }));

      return {
        output: JSON.stringify({ query, results: chunks }, null, 2),
        meta: { latencyMs: Date.now() - start, rowsAffected: results.length },
      };
    } catch (error) {
      this.logger.error(`search_knowledge failed: ${error}`);
      return { output: 'Error al buscar en la base de conocimiento.', isError: true };
    }
  }
}
