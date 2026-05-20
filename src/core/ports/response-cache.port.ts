import type { TurnContext } from '../domain/types';

export interface CacheHit {
  responseText: string;
  /** Cosine similarity al cached entry (1.0 = exacto). */
  similarity: number;
  cachedAt: Date;
}

export interface CacheableResponse {
  responseText: string;
  /** Si la respuesta involucró tools, guardarlas para invalidación selectiva. */
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
}

/**
 * Port para el response cache (capas 2 y 3 de caching).
 * Implementaciones:
 *   - src/modules/cache/exact/  -> hash sha256 + Redis
 *   - src/modules/cache/semantic/  -> embedding + pgvector
 *
 * Ver docs/01_ARCHITECTURE.md §12 para el diseño completo y safety rails.
 */
export interface ResponseCachePort {
  readonly name: string;

  /**
   * Busca una respuesta cacheada para el query dado.
   * Devuelve null si:
   *  - No hay match suficientemente similar.
   *  - El contexto del turno NO es cacheable (ej: involves stateful tool).
   *  - El cache está deshabilitado por config del business.
   */
  lookup(query: string, ctx: TurnContext): Promise<CacheHit | null>;

  /** Persiste una respuesta. Respeta safety rails (no guarda si no es cacheable). */
  store(query: string, response: CacheableResponse, ctx: TurnContext): Promise<void>;

  /** Invalida entradas de un business (ej: al actualizar catálogo). */
  invalidate(businessId: string): Promise<number>;
}
