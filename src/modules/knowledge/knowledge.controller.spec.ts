import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

function createKnowledgeService() {
  return {
    ingestFromText: vi.fn().mockResolvedValue('doc-1'),
    ingestFromFile: vi.fn().mockResolvedValue('doc-1'),
    getDocuments: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn().mockResolvedValue(null),
    deleteDocument: vi.fn().mockResolvedValue(undefined),
  } as unknown as KnowledgeService;
}

function makeReq(user: { businessId: string; role: string } | undefined) {
  return { user } as unknown as Request;
}

const file = {
  originalname: 'catalogo.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('contenido pdf'),
} as Express.Multer.File;

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  let service: ReturnType<typeof createKnowledgeService>;

  beforeEach(() => {
    service = createKnowledgeService();
    controller = new KnowledgeController(service);
  });

  describe('ingestText', () => {
    it('scopes businessId from JWT and returns documentId', async () => {
      const result = await controller.ingestText(makeReq({ businessId: 'biz-1', role: 'ADMIN' }), {
        kind: 'FAQ',
        title: 'Horarios',
        source: 'form:faq:horarios',
        text: 'Abrimos de 8am a 6pm',
      });

      expect(service.ingestFromText).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz-1' }),
      );
      expect(result).toEqual({ documentId: 'doc-1', status: 'indexed' });
    });
  });

  describe('uploadFile', () => {
    it('passes file, kind and derived title to service', async () => {
      const result = await controller.uploadFile(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        file,
        { kind: 'PDF_CATALOG' },
      );

      expect(service.ingestFromFile).toHaveBeenCalledWith(
        expect.objectContaining({
          businessId: 'biz-1',
          kind: 'PDF_CATALOG',
          title: 'catalogo.pdf',
          source: 'catalogo.pdf',
          content: file.buffer,
          mimeType: 'application/pdf',
        }),
      );
      expect(result.documentId).toBe('doc-1');
    });

    it('uses explicit title when provided', async () => {
      await controller.uploadFile(makeReq({ businessId: 'biz-1', role: 'ADMIN' }), file, {
        kind: 'PDF_CATALOG',
        title: 'Catálogo 2026',
      });

      expect(service.ingestFromFile).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Catálogo 2026' }),
      );
    });
  });

  describe('list', () => {
    it('scopes businessId from JWT', async () => {
      await controller.list(makeReq({ businessId: 'biz-1', role: 'ADMIN' }));

      expect(service.getDocuments).toHaveBeenCalledWith('biz-1');
    });
  });

  describe('delete', () => {
    it('deletes document owned by the requesting business', async () => {
      service.getDocument = vi.fn().mockResolvedValue({
        id: 'doc-1',
        businessId: 'biz-1',
        kind: 'FAQ',
        title: 'Horarios',
        source: 'form:faq:horarios',
        status: 'INDEXED',
        active: true,
      });

      const result = await controller.delete(
        'doc-1',
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(service.deleteDocument).toHaveBeenCalledWith('doc-1');
      expect(result).toEqual({ deleted: true });
    });

    it('throws NotFoundException when document does not exist', async () => {
      service.getDocument = vi.fn().mockResolvedValue(null);

      await expect(
        controller.delete('doc-x', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for cross-tenant document', async () => {
      service.getDocument = vi.fn().mockResolvedValue({
        id: 'doc-1',
        businessId: 'biz-2',
        kind: 'FAQ',
        title: 'Horarios',
        source: 'x',
        status: 'INDEXED',
        active: true,
      });

      await expect(
        controller.delete('doc-1', makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets SUPER_ADMIN delete documents from any business', async () => {
      service.getDocument = vi.fn().mockResolvedValue({
        id: 'doc-1',
        businessId: 'biz-2',
        kind: 'FAQ',
        title: 'Horarios',
        source: 'x',
        status: 'INDEXED',
        active: true,
      });

      const result = await controller.delete(
        'doc-1',
        makeReq({ businessId: 'biz-1', role: 'SUPER_ADMIN' }),
      );

      expect(service.deleteDocument).toHaveBeenCalledWith('doc-1');
      expect(result.deleted).toBe(true);
    });
  });
});
