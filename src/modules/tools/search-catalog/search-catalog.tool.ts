import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import { EMBEDDING_PROVIDER_TOKEN } from '@core/tokens';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';

const InputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(10).default(5),
});

@Injectable()
export class SearchCatalogTool implements ToolModulePort {
  readonly name = 'search_catalog';
  readonly mutatesState = false;
  private readonly logger = new Logger(SearchCatalogTool.name);

  constructor(
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly embeddings: EmbeddingProviderPort,
    private readonly productRepo: ProductRepository,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Busca productos en el catálogo del negocio usando búsqueda semántica. Encuentra productos similares a lo que el cliente busca, incluso si no usa las palabras exactas. Úsala cuando el cliente pregunte por productos, precios, disponibilidad, o recomiendes algo.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Texto de búsqueda del cliente (ej: "laptop para gaming", "algo barato para estudiar")',
          },
          limit: {
            type: 'number',
            description: 'Número máximo de resultados (default: 5)',
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
    const { query, limit } = parsed.data;

    try {
      const [vector] = await this.embeddings.embed([query]);
      const results = await this.productRepo.searchByEmbedding(ctx.businessId, vector, { limit });

      if (results.length === 0) {
        return {
          output: JSON.stringify({
            message: 'No se encontraron productos que coincidan con la búsqueda.',
            query,
          }),
        };
      }

      const products = results.map((r) => ({
        id: r.product.id,
        name: r.product.name,
        description: r.product.description,
        price: Number(r.product.price),
        category: r.product.category,
        stock: r.product.stock,
        similarity: Math.round(r.similarity * 100) + '%',
      }));

      return {
        output: JSON.stringify({ query, products }, null, 2),
        meta: { latencyMs: Date.now() - start, rowsAffected: results.length },
      };
    } catch (error) {
      this.logger.error(`search_catalog failed: ${error}`);
      return { output: 'Error al buscar productos en el catálogo.', isError: true };
    }
  }
}
