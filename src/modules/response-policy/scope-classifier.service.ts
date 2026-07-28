import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import type { BusinessRepositoryPort } from '@core/ports/business-repository.port';
import { EMBEDDING_PROVIDER_TOKEN, BUSINESS_REPOSITORY_TOKEN } from '@core/tokens';
import { KnowledgeService } from '@modules/knowledge/knowledge.service';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';

export interface ScopeResult {
  inScope: boolean;
  reason?: string;
  confidence: number;
}

interface CacheEntry {
  text: string;
  embedding: number[];
  expiresAt: number;
}

@Injectable()
export class ScopeClassifier {
  private readonly logger = new Logger(ScopeClassifier.name);
  private readonly contextCache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly embedder: EmbeddingProviderPort,
    private readonly knowledgeService: KnowledgeService,
    private readonly productRepo: ProductRepository,
    @Inject(BUSINESS_REPOSITORY_TOKEN) private readonly businessRepo: BusinessRepositoryPort,
  ) {}

  async classify(businessId: string, message: string): Promise<ScopeResult> {
    if (!message || message.trim().length === 0) {
      return { inScope: false, reason: 'Mensaje vacío', confidence: 0 };
    }

    const [msgEmbedding] = await this.embedder.embed([message]);

    const ctxSimilarity = await this.compareWithBusinessContext(businessId, msgEmbedding);
    if (ctxSimilarity > 0.35) {
      return { inScope: true, confidence: ctxSimilarity };
    }

    const knowledgeHits = await this.knowledgeService.search(businessId, message, {
      limit: 3, threshold: 0.3,
    });
    if (knowledgeHits.length > 0) {
      return { inScope: true, confidence: knowledgeHits[0].similarity };
    }

    const productHits = await this.productRepo.searchByEmbedding(businessId, msgEmbedding, {
      limit: 3, threshold: 0.3,
    });
    if (productHits.length > 0) {
      return { inScope: true, confidence: productHits[0].similarity };
    }

    return {
      inScope: false,
      reason: 'El mensaje no está relacionado con el negocio.',
      confidence: ctxSimilarity,
    };
  }

  private async compareWithBusinessContext(businessId: string, msgEmbedding: number[]): Promise<number> {
    const ctx = await this.getBusinessContext(businessId);
    if (!ctx.text) return 0;
    return this.cosineSimilarity(msgEmbedding, ctx.embedding);
  }

  private async getBusinessContext(businessId: string): Promise<CacheEntry> {
    const cached = this.contextCache.get(businessId);
    if (cached && Date.now() < cached.expiresAt) return cached;

    const business = await this.businessRepo.findById(businessId);
    if (!business) {
      const empty = { text: '', embedding: [] as number[], expiresAt: Date.now() + 60000 };
      this.contextCache.set(businessId, empty);
      return empty;
    }

    const text = [
      `Business: ${business.name ?? 'Unknown'}`,
      `About: ${(business.settings as any)?.description ?? (business.settings as any)?.industry ?? ''}`,
      `Services: ${(business.settings as any)?.services ?? ''}`,
      `Industry: ${(business.settings as any)?.industry ?? ''}`,
    ].filter(Boolean).join('\n');

    const [embedding] = await this.embedder.embed([text]);
    const entry: CacheEntry = { text, embedding, expiresAt: Date.now() + this.CACHE_TTL_MS };
    this.contextCache.set(businessId, entry);
    return entry;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
