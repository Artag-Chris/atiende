import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { KnowledgeChunk } from '@prisma/client';

export interface ChunkSearchResult {
  chunk: KnowledgeChunk;
  similarity: number;
}

@Injectable()
export class KnowledgeChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async searchByEmbedding(
    businessId: string,
    embedding: number[],
    options?: { limit?: number; threshold?: number; kind?: string },
  ): Promise<ChunkSearchResult[]> {
    const limit = options?.limit ?? 5;
    const threshold = options?.threshold ?? 0.6;
    const kind = options?.kind ?? null;
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
      `SELECT kc.id,
              1 - (kc.embedding <=> $1::vector) as similarity
       FROM knowledge_chunks kc
       JOIN knowledge_documents kd ON kd.id = kc.document_id
       WHERE kc.business_id = $2::uuid
         AND kd.active = true
         AND 1 - (kc.embedding <=> $1::vector) > $3
         AND ($4::knowledge_kind IS NULL OR kc.kind = $4::knowledge_kind)
       ORDER BY kc.embedding <=> $1::vector
       LIMIT $5`,
      vectorStr,
      businessId,
      threshold,
      kind,
      limit,
    );

    const chunkIds = rows.map((r) => r.id);
    if (chunkIds.length === 0) return [];

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { id: { in: chunkIds } },
    });
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    return rows
      .map((r) => ({
        chunk: chunkMap.get(r.id)!,
        similarity: Number(r.similarity),
      }))
      .filter((r) => r.chunk);
  }

  async batchSave(
    chunks: Array<{
      documentId: string;
      businessId: string;
      kind: string;
      position: number;
      text: string;
      pageNumber?: number | null;
      embeddingModel: string;
      embedding: number[];
    }>,
  ): Promise<void> {
    if (chunks.length === 0) return;

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_, j) => {
        const base = j * 8;
        return `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::knowledge_kind, $${base + 4}, $${base + 5}, $${base + 6}::int, $${base + 7}, $${base + 8}::vector)`;
      });

      const values = batch.flatMap((c) => [
        c.documentId,
        c.businessId,
        c.kind,
        c.position,
        c.text,
        c.pageNumber ?? null,
        c.embeddingModel,
        `[${c.embedding.join(',')}]`,
      ]);

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (document_id, business_id, kind, position, text, page_number, embedding_model, embedding)
         VALUES ${placeholders.join(', ')}`,
        ...values,
      );
    }
  }

  async countByDocument(documentId: string): Promise<number> {
    return this.prisma.knowledgeChunk.count({ where: { documentId } });
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.prisma.knowledgeChunk.deleteMany({ where: { documentId } });
  }
}
