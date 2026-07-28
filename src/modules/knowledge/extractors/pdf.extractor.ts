import { Injectable, Logger } from '@nestjs/common';
import type { DocumentExtractorPort, ExtractResult } from '@core/ports/document-extractor.port';

@Injectable()
export class PdfExtractor implements DocumentExtractorPort {
  readonly supportedMimeTypes = ['application/pdf'];
  private readonly logger = new Logger(PdfExtractor.name);

  async extract(content: Buffer): Promise<ExtractResult> {
    try {
      const pdfParse = await this.importPdfParse();
      const data = await pdfParse(content);
      return {
        text: data.text,
        metadata: {
          pages: data.numpages,
          title: data.info?.Title,
          author: data.info?.Author,
        },
      };
    } catch (error) {
      this.logger.error(`PDF extraction failed: ${error}`);
      return { text: '', metadata: { error: String(error) } };
    }
  }

  private async importPdfParse() {
    const pdfParse = await import('pdf-parse');
    return pdfParse.default ?? pdfParse;
  }
}
