/**
 * Port para extractores de documentos.
 *
 * Cada extractor convierte un archivo binario (PDF, CSV, Excel, etc.) en
 * texto estructurado en segmentos. Los segmentos van al ChunkerPort luego.
 *
 * Implementaciones (Semana 4):
 *   - src/modules/extractors/pdf-text/   -> pdf-parse (PDFs con texto seleccionable)
 *   - src/modules/extractors/pdf-ocr/    -> tesseract.js (PDFs escaneados, v2 opcional)
 *   - src/modules/extractors/csv/        -> csv-parse
 *   - src/modules/extractors/excel/      -> exceljs
 *   - src/modules/extractors/markdown/   -> texto plano
 *
 * El DocumentExtractorRegistry (en el módulo de knowledge) selecciona el
 * extractor correcto según mimeType + filename.
 */

/**
 * Una porción del documento con metadata posicional opcional.
 * Para PDFs: una entrada por página. Para CSV/Excel: una por fila.
 * Para texto plano sin estructura: una sola entrada con todo.
 */
export interface DocumentSegment {
  text: string;
  /** Localizador opcional para citas en respuestas del agente. */
  locator?: {
    pageNumber?: number;
    row?: number;
    section?: string;
  };
}

export interface ExtractedDocument {
  /** Texto plano concatenado de todo el documento. Útil para preview/hash. */
  fullText: string;
  /** Segmentos con metadata posicional. */
  segments: DocumentSegment[];
  /** Metadata del documento original (title, author, pageCount, etc.). */
  metadata?: Record<string, unknown>;
  /** SHA256 del contenido original — para detectar cambios entre re-uploads. */
  sourceHash: string;
}

export interface DocumentExtractorPort {
  readonly name: string;
  /** MIME types que este extractor puede procesar. */
  readonly supportedMimeTypes: readonly string[];

  /**
   * Devuelve true si este extractor puede procesar el archivo.
   * Algunos extractores deciden por extensión del filename además del MIME.
   */
  canHandle(mimeType: string, filename: string): boolean;

  /**
   * Extrae el contenido del archivo a texto estructurado.
   * Lanza si el archivo está corrupto o no es del formato esperado.
   */
  extract(buffer: Buffer, filename: string): Promise<ExtractedDocument>;
}
