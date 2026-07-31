import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { KnowledgeDocumentRepository } from '@modules/persistence/postgres/knowledge-document.repository';
import { KnowledgeChunkRepository } from '@modules/persistence/postgres/knowledge-chunk.repository';
import type { DocumentExtractorPort } from '@core/ports/document-extractor.port';
import type { ChunkerPort } from '@core/ports/chunker.port';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import { DOCUMENT_EXTRACTORS_TOKEN, CHUNKER_TOKEN, EMBEDDING_PROVIDER_TOKEN } from '@core/tokens';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly docRepo: KnowledgeDocumentRepository,
    private readonly chunkRepo: KnowledgeChunkRepository,
    @Inject(DOCUMENT_EXTRACTORS_TOKEN) private readonly extractors: DocumentExtractorPort[],
    @Inject(CHUNKER_TOKEN) private readonly chunker: ChunkerPort,
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly embedder: EmbeddingProviderPort,
  ) {}

  async ingestFromText(data: {
    businessId: string;
    kind: string;
    title: string;
    source: string;
    text: string;
  }): Promise<string> {
    const sourceHash = this.hashContent(data.text);
    const doc = await this.docRepo.findOrCreate({
      businessId: data.businessId,
      kind: data.kind,
      title: data.title,
      source: data.source,
      sourceHash,
    });

    if (doc.status === 'INDEXED' && doc.sourceHash === sourceHash) {
      this.logger.log(`Document ${doc.id} unchanged, skipping`);
      return doc.id;
    }

    await this.docRepo.updateStatus(doc.id, 'CHUNKING');
    await this.chunkRepo.deleteByDocument(doc.id);

    const rawChunks = this.chunker.chunk({ text: data.text });
    try {
      await this.saveChunks(doc.id, data.businessId, data.kind, rawChunks);

      const totalChunks = await this.chunkRepo.countByDocument(doc.id);
      await this.docRepo.updateStatus(doc.id, 'INDEXED', { chunkCount: totalChunks });
    } catch (error) {
      await this.docRepo.updateStatus(doc.id, 'FAILED', {
        errorMessage: `Embedding failed: ${(error as Error).message}`,
      });
      throw error;
    }

    return doc.id;
  }

  async ingestFromFile(data: {
    businessId: string;
    kind: string;
    title: string;
    source: string;
    content: Buffer;
    mimeType: string;
  }): Promise<string> {
    const sourceHash = this.hashBuffer(data.content);
    const doc = await this.docRepo.findOrCreate({
      businessId: data.businessId,
      kind: data.kind,
      title: data.title,
      source: data.source,
      sourceHash,
    });

    if (doc.status === 'INDEXED' && doc.sourceHash === sourceHash) {
      this.logger.log(`Document ${doc.id} unchanged, skipping`);
      return doc.id;
    }

    await this.docRepo.updateStatus(doc.id, 'EXTRACTING');

    const extractor = this.extractors.find((e) => e.supportedMimeTypes.includes(data.mimeType));

    if (!extractor) {
      const msg = `No extractor for mime type ${data.mimeType}`;
      await this.docRepo.updateStatus(doc.id, 'FAILED', { errorMessage: msg });
      throw new Error(msg);
    }

    const extracted = await extractor.extract(data.content, data.mimeType);
    if (!extracted.text || extracted.text.trim().length === 0) {
      const msg = 'Extractor returned empty text';
      await this.docRepo.updateStatus(doc.id, 'FAILED', { errorMessage: msg });
      throw new Error(msg);
    }

    await this.docRepo.updateStatus(doc.id, 'CHUNKING');
    await this.chunkRepo.deleteByDocument(doc.id);

    try {
      if (extracted.pages && extracted.pages.length > 0) {
        for (const page of extracted.pages) {
          const rawChunks = this.chunker.chunk({ text: page.text, pageNumber: page.pageNumber });
          await this.saveChunks(doc.id, data.businessId, data.kind, rawChunks);
        }
      } else {
        const rawChunks = this.chunker.chunk({ text: extracted.text });
        await this.saveChunks(doc.id, data.businessId, data.kind, rawChunks);
      }

      const totalChunks = await this.chunkRepo.countByDocument(doc.id);
      await this.docRepo.updateStatus(doc.id, 'INDEXED', { chunkCount: totalChunks });
    } catch (error) {
      await this.docRepo.updateStatus(doc.id, 'FAILED', {
        errorMessage: `Embedding failed: ${(error as Error).message}`,
      });
      throw error;
    }

    return doc.id;
  }

  private async saveChunks(
    documentId: string,
    businessId: string,
    kind: string,
    rawChunks: Array<{ text: string; position: number; pageNumber?: number }>,
  ): Promise<void> {
    if (rawChunks.length === 0) return;

    const embeddingModel = this.embedder.name;

    await this.docRepo.updateStatus(documentId, 'EMBEDDING');

    const CONCURRENCY = 5;
    const results: Array<{
      documentId: string;
      businessId: string;
      kind: string;
      position: number;
      text: string;
      pageNumber?: number | null;
      embeddingModel: string;
      embedding: number[];
    }> = [];

    for (let i = 0; i < rawChunks.length; i += CONCURRENCY) {
      const batch = rawChunks.slice(i, i + CONCURRENCY);
      const embeddings = await Promise.all(
        batch.map((raw) => this.embedder.embed([raw.text]).then(([vec]) => vec)),
      );

      for (let j = 0; j < batch.length; j++) {
        results.push({
          documentId,
          businessId,
          kind,
          position: batch[j].position,
          text: batch[j].text,
          pageNumber: batch[j].pageNumber ?? null,
          embeddingModel,
          embedding: embeddings[j],
        });
      }
    }

    await this.chunkRepo.batchSave(results);
  }

  async search(
    businessId: string,
    query: string,
    options?: { limit?: number; threshold?: number; kind?: string },
  ) {
    const [queryEmbedding] = await this.embedder.embed([query]);
    return this.chunkRepo.searchByEmbedding(businessId, queryEmbedding, options);
  }

  async getDocuments(businessId: string) {
    return this.docRepo.findByBusiness(businessId);
  }

  async getDocument(id: string) {
    return this.docRepo.findById(id);
  }

  async deleteDocument(id: string): Promise<void> {
    await this.docRepo.softDelete(id);
  }

  private hashContent(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
  }

  private hashBuffer(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }
}
