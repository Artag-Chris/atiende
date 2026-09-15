import { Injectable, Logger } from '@nestjs/common';
import type { DocumentExtractorPort, ExtractResult } from '@core/ports/document-extractor.port';

/**
 * Extractores de texto plano: .md (Markdown) y .txt.
 *
 * No se "limpia" el Markdown a propósito: los headings y listas crudos
 * estructuran bien el chunking (que corta por párrafos) y el LLM los lee bien.
 */
@Injectable()
export class MarkdownExtractor implements DocumentExtractorPort {
  readonly supportedMimeTypes = ['text/markdown', 'text/x-markdown', 'text/plain'];
  private readonly logger = new Logger(MarkdownExtractor.name);

  async extract(content: Buffer): Promise<ExtractResult> {
    try {
      const text = content.toString('utf-8');
      return {
        text,
        metadata: {
          charCount: text.length,
          lineCount: text.split('\n').length,
        },
      };
    } catch (error) {
      this.logger.error(`Markdown extraction failed: ${error}`);
      return { text: '', metadata: { error: String(error) } };
    }
  }
}
