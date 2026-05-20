/**
 * Port para proveedores de embeddings (OpenAI text-embedding-3-small, Voyage, etc.).
 */
export interface EmbeddingProviderPort {
  readonly name: string;

  /** Dimensión del vector que devuelve este provider (e.g., 1536). */
  readonly dimension: number;

  /** Genera el embedding de un texto. */
  embed(text: string): Promise<number[]>;

  /** Batch para indexar catálogo: más barato y rápido que llamarlo N veces. */
  embedBatch(texts: string[]): Promise<number[][]>;
}
