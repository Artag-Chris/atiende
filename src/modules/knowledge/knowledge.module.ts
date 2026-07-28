import { Global, Module, Provider } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeDocumentRepository } from '@modules/persistence/postgres/knowledge-document.repository';
import { KnowledgeChunkRepository } from '@modules/persistence/postgres/knowledge-chunk.repository';
import { PdfExtractor } from './extractors/pdf.extractor';
import { CsvExtractor } from './extractors/csv.extractor';
import { TextChunker } from './text-chunker';
import { DOCUMENT_EXTRACTORS_TOKEN, CHUNKER_TOKEN } from '@core/tokens';

const extractorsProviders: Provider[] = [
  PdfExtractor,
  CsvExtractor,
  {
    provide: DOCUMENT_EXTRACTORS_TOKEN,
    useFactory: (...extractors: PdfExtractor[]) => extractors,
    inject: [PdfExtractor, CsvExtractor],
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
      useClass: TextChunker,
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
