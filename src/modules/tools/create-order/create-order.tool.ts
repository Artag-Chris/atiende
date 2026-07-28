import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';

const InputSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  notes: z.string().max(500).optional(),
});

@Injectable()
export class CreateOrderTool implements ToolModulePort {
  readonly name = 'create_order';
  readonly mutatesState = true;
  private readonly logger = new Logger(CreateOrderTool.name);

  constructor(private readonly productRepo: ProductRepository) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Crea una orden de compra para un producto. Úsala cuando el cliente quiera comprar algo, hacer un pedido, o reserve un producto. Confirma el stock disponible antes de crear la orden.',
      inputSchema: {
        type: 'object',
        properties: {
          product_id: {
            type: 'string',
            description: 'UUID del producto a ordenar.',
          },
          quantity: {
            type: 'number',
            description: 'Cantidad a ordenar (mínimo 1).',
          },
          notes: {
            type: 'string',
            description: 'Notas adicionales del pedido (opcional).',
          },
        },
        required: ['product_id', 'quantity'],
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
    const { product_id, quantity, notes } = parsed.data;

    try {
      const product = await this.productRepo.findById(product_id);
      if (!product || product.businessId !== ctx.businessId) {
        return { output: 'Producto no encontrado.', isError: true };
      }

      if (product.stock < quantity) {
        return {
          output: JSON.stringify({
            status: 'insufficient_stock',
            message: `Solo hay ${product.stock} unidades disponibles de "${product.name}".`,
            available: product.stock,
            requested: quantity,
          }),
        };
      }

      const order = {
        orderId: `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        productId: product_id,
        productName: product.name,
        quantity,
        unitPrice: Number(product.price),
        totalPrice: Number(product.price) * quantity,
        notes,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      this.logger.log(
        `Order created: ${order.orderId} for ${quantity}x "${product.name}" by ${ctx.customerPhone}`,
      );

      return {
        output: JSON.stringify(
          {
            status: 'created',
            message: `¡Pedido confirmado! ${quantity}x "${product.name}" por $${order.totalPrice.toFixed(2)}. Tu número de orden es ${order.orderId}.`,
            order,
          },
          null,
          2,
        ),
        meta: { latencyMs: Date.now() - start, rowsAffected: 1 },
      };
    } catch (error) {
      this.logger.error(`create_order failed: ${error}`);
      return { output: 'Error al crear la orden. Intenta de nuevo.', isError: true };
    }
  }
}
