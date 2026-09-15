import { Global, Module, Provider } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocumentRepository } from '@modules/persistence/postgres/knowledge-document.repository';
import { KnowledgeChunkRepository } from '@modules/persistence/postgres/knowledge-chunk.repository';
import { PdfExtractor } from './extractors/pdf.extractor';
import { CsvExtractor } from './extractors/csv.extractor';
import { MarkdownExtractor } from './extractors/markdown.extractor';
import { ExcelExtractor } from './extractors/excel.extractor';
import { TextChunker } from './text-chunker';
import { DOCUMENT_EXTRACTORS_TOKEN, CHUNKER_TOKEN } from '@core/tokens';
import type { DocumentExtractorPort } from '@core/ports/document-extractor.port';

const EXTRACTOR_CLASSES = [PdfExtractor, CsvExtractor, MarkdownExtractor, ExcelExtractor];

const extractorsProviders: Provider[] = [
  ...EXTRACTOR_CLASSES,
  {
    provide: DOCUMENT_EXTRACTORS_TOKEN,
    useFactory: (...extractors: DocumentExtractorPort[]) => extractors,
    inject: EXTRACTOR_CLASSES,
  },
];

@Global()
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeDocumentRepository,
    KnowledgeChunkRepository,
    ...extractorsProviders,
    {
      provide: CHUNKER_TOKEN,
      useFactory: () => new TextChunker(),
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
