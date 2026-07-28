import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';

const InputSchema = z.object({
  product_id: z.string().uuid(),
});

@Injectable()
export class GetProductTool implements ToolModulePort {
  readonly name = 'get_product';
  readonly mutatesState = false;
  private readonly logger = new Logger(GetProductTool.name);

  constructor(private readonly productRepo: ProductRepository) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Obtiene el detalle completo de un producto específico por su ID. Úsala cuando el cliente quiera ver detalles de un producto que ya encontraste, como precio exacto, descripción completa, stock, o categoría.',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: {
            type: 'string',
            description: 'UUID del producto a consultar.',
          },
        },
        required: ['product_id'],
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
    const { product_id } = parsed.data;

    try {
      const product = await this.productRepo.findById(product_id);
      if (!product || product.businessId !== ctx.businessId) {
        return { output: 'Producto no encontrado.', isError: true };
      }

      return {
        output: JSON.stringify(
          {
            id: product.id,
            name: product.name,
            description: product.description,
            price: Number(product.price),
            stock: product.stock,
            category: product.category,
            imageUrl: product.imageUrl,
          },
          null,
          2,
        ),
        meta: { latencyMs: Date.now() - start },
      };
    } catch (error) {
      this.logger.error(`get_product failed: ${error}`);
      return { output: 'Error al obtener el producto.', isError: true };
    }
  }
}
