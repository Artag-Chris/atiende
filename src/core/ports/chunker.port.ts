import type { DocumentSegment } from './document-extractor.port';

/**
 * Port para chunkers — convierten segmentos del extractor en chunks listos
 * para embedding (tamaño controlado, con overlap opcional).
 *
 * Estrategias futuras (Semana 4+):
 *   - FixedSizeChunker (default v1): split por tokens, overlap configurable.
 *   - SemanticChunker: split por límites semánticos detectados con embeddings.
 *   - StructuralChunker: respeta secciones de markdown / encabezados HTML.
 */

export interface Chunk {
  text: string;
  /** Posición ordinal del chunk dentro del documento (0-indexed). */
  position: number;
  /** Localizador heredado del segmento (página, fila, sección) para citas. */
  locator?: DocumentSegment['locator'];
  /** Estimación de tokens del chunk. Útil para verificar costos antes de embed. */
  estimatedTokens: number;
}

export interface ChunkerPort {
  readonly name: string;
  /** Tamaño máximo en tokens por chunk (no exceder ~8K — límite OpenAI embeddings). */
  readonly maxTokensPerChunk: number;
  /** Tokens de overlap entre chunks consecutivos (preserva contexto en bordes). */
  readonly overlapTokens: number;

  /**
   * Toma segmentos del extractor y devuelve chunks. Si un segmento es más
   * grande que maxTokensPerChunk, lo parte. Si es mucho más chico, puede
   * combinar varios segmentos en un chunk para no fragmentar demasiado.
   */
  chunk(segments: DocumentSegment[]): Chunk[];
}
