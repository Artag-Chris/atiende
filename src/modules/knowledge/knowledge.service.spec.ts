import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeDocumentRepository } from '@modules/persistence/postgres/knowledge-document.repository';
import type { KnowledgeChunkRepository } from '@modules/persistence/postgres/knowledge-chunk.repository';
import type { DocumentExtractorPort } from '@core/ports/document-extractor.port';
import type { ChunkerPort } from '@core/ports/chunker.port';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import type { ResponseCachePort } from '@core/ports/response-cache.port';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex');

function createDocRepo() {
  return {
    findOrCreate: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn(),
    findByBusiness: vi.fn(),
    softDelete: vi.fn(),
  };
}

function createChunkRepo() {
  return {
    deleteByDocument: vi.fn().mockResolvedValue(undefined),
    countByDocument: vi.fn().mockResolvedValue(1),
    batchSave: vi.fn().mockResolvedValue(undefined),
    searchByEmbedding: vi.fn(),
  };
}

function createExtractor(): DocumentExtractorPort {
  return {
    supportedMimeTypes: ['text/markdown'],
    extract: vi.fn().mockResolvedValue({ text: 'contenido extraído', metadata: {} }),
  };
}

function createChunker(count: number): ChunkerPort {
  return {
    chunk: vi.fn().mockReturnValue(
      Array.from({ length: count }, (_, index) => ({
        text: `chunk ${index}`,
        position: index,
      })),
    ),
  };
}

function createEmbedder(): EmbeddingProviderPort {
  return {
    name: 'openai',
    embed: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1, 0.2])),
      ) as unknown as EmbeddingProviderPort['embed'],
    dimension: () => 1536,
  };
}

function createCache(name: string): ResponseCachePort {
  return {
    name,
    lookup: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(0),
  };
}

function buildService(options?: {
  docRepo?: ReturnType<typeof createDocRepo>;
  chunkRepo?: ReturnType<typeof createChunkRepo>;
  embedder?: EmbeddingProviderPort;
  chunkCount?: number;
  semanticCache?: ResponseCachePort;
  exactCache?: ResponseCachePort;
}) {
  const docRepo = options?.docRepo ?? createDocRepo();
  const chunkRepo = options?.chunkRepo ?? createChunkRepo();
  const embedder = options?.embedder ?? createEmbedder();

  const service = new KnowledgeService(
    docRepo as unknown as KnowledgeDocumentRepository,
    chunkRepo as unknown as KnowledgeChunkRepository,
    [createExtractor()],
    createChunker(options?.chunkCount ?? 1),
    embedder,
    options?.semanticCache,
    options?.exactCache,
  );

  return { service, docRepo, chunkRepo, embedder };
}

const textInput = {
  businessId: 'biz-1',
  kind: 'NOTES',
  title: 'Precios',
  source: 'contenido/precios.md',
  text: 'contenido',
};

describe('KnowledgeService', () => {
  describe('ingestFromText', () => {
    it('indexes the document and reports the chunk count', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'PENDING',
        sourceHash: 'stale',
      });
      const chunkRepo = createChunkRepo();
      chunkRepo.countByDocument.mockResolvedValue(3);

      const { service } = buildService({ docRepo, chunkRepo, chunkCount: 3 });
      const id = await service.ingestFromText(textInput);

      expect(id).toBe('doc-1');
      expect(chunkRepo.deleteByDocument).toHaveBeenCalledWith('doc-1');
      expect(chunkRepo.batchSave).toHaveBeenCalledTimes(1);
      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-1', 'INDEXED', { chunkCount: 3 });
    });

    it('skips an unchanged document without embedding or invalidating caches', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'INDEXED',
        sourceHash: sha256('contenido'),
      });
      const chunkRepo = createChunkRepo();
      const semanticCache = createCache('semantic');
      const exactCache = createCache('exact');

      const { service, embedder } = buildService({ docRepo, chunkRepo, semanticCache, exactCache });
      const id = await service.ingestFromText(textInput);

      expect(id).toBe('doc-1');
      expect(embedder.embed).not.toHaveBeenCalled();
      expect(chunkRepo.batchSave).not.toHaveBeenCalled();
      expect(docRepo.updateStatus).not.toHaveBeenCalled();
      expect(semanticCache.invalidate).not.toHaveBeenCalled();
      expect(exactCache.invalidate).not.toHaveBeenCalled();
    });

    it('invalidates the response caches after a real re-index', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'INDEXED',
        sourceHash: 'stale',
      });
      const semanticCache = createCache('semantic');
      const exactCache = createCache('exact');

      const { service } = buildService({ docRepo, semanticCache, exactCache });
      await service.ingestFromText(textInput);

      expect(semanticCache.invalidate).toHaveBeenCalledWith('biz-1');
      expect(exactCache.invalidate).toHaveBeenCalledWith('biz-1');
    });

    it('still indexes when cache invalidation fails', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'PENDING',
        sourceHash: 'stale',
      });
      const semanticCache = createCache('semantic');
      semanticCache.invalidate = vi.fn().mockRejectedValue(new Error('redis down'));

      const { service } = buildService({ docRepo, semanticCache });

      await expect(service.ingestFromText(textInput)).resolves.toBe('doc-1');
      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-1', 'INDEXED', { chunkCount: 1 });
    });

    it('marks the document FAILED and rethrows when embedding fails', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'PENDING',
        sourceHash: 'stale',
      });
      const embedder = createEmbedder();
      embedder.embed = vi.fn().mockRejectedValue(new Error('openai 429'));

      const { service } = buildService({ docRepo, embedder });

      await expect(service.ingestFromText(textInput)).rejects.toThrow('openai 429');
      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-1', 'FAILED', {
        errorMessage: expect.stringContaining('Embedding failed'),
      });
    });

    it('leaves an empty document INDEXED with zero chunks', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-1',
        status: 'PENDING',
        sourceHash: 'stale',
      });
      const chunkRepo = createChunkRepo();
      chunkRepo.countByDocument.mockResolvedValue(0);

      const { service, embedder } = buildService({ docRepo, chunkRepo, chunkCount: 0 });
      await service.ingestFromText(textInput);

      expect(embedder.embed).not.toHaveBeenCalled();
      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-1', 'INDEXED', { chunkCount: 0 });
    });
  });

  describe('ingestFromFile', () => {
    it('extracts via the matching extractor and indexes the resulting chunks', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-2',
        status: 'PENDING',
        sourceHash: 'stale',
      });
      const chunkRepo = createChunkRepo();
      chunkRepo.countByDocument.mockResolvedValue(2);

      const { service, embedder } = buildService({ docRepo, chunkRepo, chunkCount: 2 });
      const id = await service.ingestFromFile({
        businessId: 'biz-1',
        kind: 'NOTES',
        title: 'Precios',
        source: 'precios.md',
        content: Buffer.from('# Precios'),
        mimeType: 'text/markdown',
      });

      expect(id).toBe('doc-2');
      expect(embedder.embed).toHaveBeenCalledTimes(2);
      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-2', 'INDEXED', { chunkCount: 2 });
    });

    it('marks the document FAILED when no extractor matches the mime type', async () => {
      const docRepo = createDocRepo();
      docRepo.findOrCreate.mockResolvedValue({
        id: 'doc-3',
        status: 'PENDING',
        sourceHash: 'stale',
      });

      const { service } = buildService({ docRepo });

      await expect(
        service.ingestFromFile({
          businessId: 'biz-1',
          kind: 'NOTES',
          title: 'X',
          source: 'x.exe',
          content: Buffer.from('MZ'),
          mimeType: 'application/x-msdownload',
        }),
      ).rejects.toThrow('No extractor for mime type application/x-msdownload');

      expect(docRepo.updateStatus).toHaveBeenCalledWith('doc-3', 'FAILED', {
        errorMessage: 'No extractor for mime type application/x-msdownload',
      });
    });
  });

  describe('search', () => {
    it('embeds the query and delegates to the chunk repository', async () => {
      const chunkRepo = createChunkRepo();
      chunkRepo.searchByEmbedding.mockResolvedValue([]);

      const { service } = buildService({ chunkRepo });
      await service.search('biz-1', 'cuánto cuesta una web', { limit: 3 });

      expect(chunkRepo.searchByEmbedding).toHaveBeenCalledWith('biz-1', [0.1, 0.2], {
        limit: 3,
      });
    });
  });
});
