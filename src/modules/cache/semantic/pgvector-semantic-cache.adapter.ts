import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ResponseCachePort,
  CacheHit,
  CacheableResponse,
} from '@core/ports/response-cache.port';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import type { TurnContext } from '@core/domain/types';
import { EMBEDDING_PROVIDER_TOKEN, FEATURES_TOKEN } from '@core/tokens';
import type { Features } from '@config/features';
import { PrismaService } from '../../persistence/postgres/prisma.service';

interface SemanticCacheRow {
  response_text: string;
  tool_calls: unknown;
  cached_at: Date;
  similarity: number;
}

@Injectable()
export class PgvectorSemanticCacheAdapter implements ResponseCachePort {
  readonly name = 'semantic';
  private readonly logger = new Logger(PgvectorSemanticCacheAdapter.name);
  private readonly embeddingModel = 'text-embedding-3-small';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly embedder: EmbeddingProviderPort,
    @Inject(FEATURES_TOKEN) private readonly features: Features,
  ) {}

  private isCacheable(ctx: TurnContext): boolean {
    if (!this.features.cache.semantic) return false;
    if (ctx.mayInvolveStatefulTool) return false;
    if (ctx.hasPersonalInfo) return false;
    return true;
  }

  async lookup(query: string, ctx: TurnContext): Promise<CacheHit | null> {
    if (!this.isCacheable(ctx)) return null;

    const [vector] = await this.embedder.embed([query]).catch((err: Error) => {
      this.logger.warn(`Embedding error during lookup: ${err.message}`);
      return [null] as (number[] | null)[];
    });
    if (!vector) return null;

    const vectorStr = `[${vector.join(',')}]`;
    const threshold = this.features.cache.semanticMinSimilarity;

    try {
      const rows = await this.prisma.$queryRaw<Array<SemanticCacheRow & { id: string }>>`
        SELECT id, response_text, tool_calls, created_at as cached_at,
               1 - (query_embedding <=> ${vectorStr}::vector) as similarity
        FROM response_cache
        WHERE business_id = ${ctx.businessId}::uuid
          AND embedding_model = ${this.embeddingModel}
          AND expires_at > NOW()
          AND 1 - (query_embedding <=> ${vectorStr}::vector) > ${threshold}
        ORDER BY query_embedding <=> ${vectorStr}::vector
        LIMIT 1
      `;

      if (rows.length === 0) return null;

      const row = rows[0];
      const similarity = Number(row.similarity);

      try {
        await this.prisma.$executeRaw`
          UPDATE response_cache
          SET hit_count = hit_count + 1, last_used_at = NOW()
          WHERE id = ${row.id}::uuid
        `;
      } catch (updateErr) {
        this.logger.warn(`Failed to update cache hit stats: ${updateErr}`);
      }

      this.logger.debug(
        `Semantic cache HIT for business=${ctx.businessId} similarity=${similarity.toFixed(4)}`,
      );
      return {
        responseText: row.response_text,
        similarity,
        cachedAt: new Date(row.cached_at),
      };
    } catch (err) {
      this.logger.warn(`Semantic cache lookup error: ${err}`);
      return null;
    }
  }

  async store(query: string, response: CacheableResponse, ctx: TurnContext): Promise<void> {
    if (!this.isCacheable(ctx)) return;

    const [vector] = await this.embedder.embed([query]).catch((err: Error) => {
      this.logger.warn(`Embedding error during store: ${err.message}`);
      return [null] as (number[] | null)[];
    });
    if (!vector) return;

    const vectorStr = `[${vector.join(',')}]`;
    const ttlSeconds = this.features.cache.semanticTtlSeconds;

    try {
      await this.prisma.$executeRaw`
        INSERT INTO response_cache (business_id, embedding_model, query_text, query_embedding, response_text, tool_calls, hit_count, expires_at, created_at)
        VALUES (${ctx.businessId}::uuid, ${this.embeddingModel}, ${query}, ${vectorStr}::vector, ${response.responseText}, ${JSON.stringify(response.toolCalls ?? [])}::json, 0, NOW() + ${ttlSeconds} * INTERVAL '1 second', NOW())
      `;
      this.logger.debug(`Semantic cache STORE for business=${ctx.businessId}`);
    } catch (err) {
      this.logger.warn(`Failed to store semantic cache: ${err}`);
    }
  }

  async invalidate(businessId: string): Promise<number> {
    try {
      const result = await this.prisma.$executeRaw`
        DELETE FROM response_cache WHERE business_id = ${businessId}::uuid
      `;
      this.logger.log(`Invalidated semantic cache for business=${businessId}`);
      return result;
    } catch (err) {
      this.logger.warn(`Failed to invalidate semantic cache: ${err}`);
      return 0;
    }
  }
}
