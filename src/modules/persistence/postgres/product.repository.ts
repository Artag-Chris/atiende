import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { Product } from '@prisma/client';

export interface ProductSearchResult {
  product: Product;
  similarity: number;
}

@Injectable()
export class ProductRepository {
  private readonly logger = new Logger(ProductRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async findByBusiness(
    businessId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { businessId, active: true },
      orderBy: { name: 'asc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  /** Busca un servicio (producto) del business por su categoría (los servicios
   *  LumenX tienen categorías únicas: "Desarrollo", "IA", etc.). */
  async findByBusinessAndCategory(businessId: string, category: string): Promise<Product | null> {
    return this.prisma.product.findFirst({
      where: { businessId, active: true, category },
    });
  }

  async searchByEmbedding(
    businessId: string,
    embedding: number[],
    options?: { limit?: number; threshold?: number },
  ): Promise<ProductSearchResult[]> {
    const limit = options?.limit ?? 5;
    const threshold = options?.threshold ?? 0.7;

    const vectorStr = `[${embedding.join(',')}]`;
    const results = await this.prisma.$queryRaw<Array<{ product_id: string; similarity: number }>>`
      SELECT p.id as product_id, 
             1 - (pe.embedding <=> ${vectorStr}::vector) as similarity
      FROM product_embeddings pe
      JOIN products p ON p.id = pe.product_id
      WHERE p.business_id = ${businessId}::uuid
        AND p.active = true
        AND 1 - (pe.embedding <=> ${vectorStr}::vector) > ${threshold}
      ORDER BY pe.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    const products = await this.prisma.product.findMany({
      where: { id: { in: results.map((r) => r.product_id) } },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));
    return results
      .map((r) => ({
        product: productMap.get(r.product_id)!,
        similarity: Number(r.similarity),
      }))
      .filter((r) => r.product);
  }

  async saveEmbedding(productId: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      INSERT INTO product_embeddings (product_id, embedding, updated_at)
      VALUES (${productId}::uuid, ${vectorStr}::vector, NOW())
      ON CONFLICT (product_id) 
      DO UPDATE SET embedding = ${vectorStr}::vector, updated_at = NOW()
    `;
  }
}
