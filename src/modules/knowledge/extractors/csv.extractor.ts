import { Injectable, Logger } from '@nestjs/common';
import type { DocumentExtractorPort, ExtractResult } from '@core/ports/document-extractor.port';

@Injectable()
export class CsvExtractor implements DocumentExtractorPort {
  readonly supportedMimeTypes = ['text/csv', 'text/comma-separated-values'];
  private readonly logger = new Logger(CsvExtractor.name);

  async extract(content: Buffer): Promise<ExtractResult> {
    try {
      const text = content.toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      const header = lines[0] ?? '';
      const rows = lines.slice(1);

      const formatted = [
        `CSV Import - Headers: ${header}`,
        '',
        ...rows.map((row, i) => `Row ${i + 1}: ${row}`),
      ].join('\n');

      return {
        text: formatted,
        metadata: {
          rowCount: rows.length,
          headers: header.split(',').map((h) => h.trim()),
        },
      };
    } catch (error) {
      this.logger.error(`CSV extraction failed: ${error}`);
      return { text: '', metadata: { error: String(error) } };
    }
  }
}
