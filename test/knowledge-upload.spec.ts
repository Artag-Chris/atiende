import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { KnowledgeController } from '@modules/knowledge/knowledge.controller';
import { KnowledgeService } from '@modules/knowledge/knowledge.service';
import { JwtAuthGuard } from '@modules/auth/jwt-auth.guard';

/**
 * Verifica la superficie HTTP real de la subida de conocimiento: que el
 * multipart atraviese FileInterceptor + ParseFilePipe y que el tipo de archivo
 * se resuelva por extensión (los navegadores reportan MIME inconsistente).
 */
describe('KnowledgeController upload (HTTP)', () => {
  let app: INestApplication;

  const knowledgeService = {
    ingestFromFile: vi.fn().mockResolvedValue('doc-1'),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [{ provide: KnowledgeService, useValue: knowledgeService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = { businessId: 'biz-1', role: 'ADMIN' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    // vitest transpila con esbuild, que no emite design:paramtypes, así que
    // Nest no puede resolver el constructor por tipo y lo deja undefined.
    // Se inyecta el doble a mano para poder ejercitar el handler completo.
    const controller = app.get(KnowledgeController);
    (controller as unknown as { knowledgeService: unknown }).knowledgeService = knowledgeService;
  });

  beforeEach(() => {
    knowledgeService.ingestFromFile.mockClear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts a .md upload and resolves its mime type from the extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/knowledge/upload')
      .field('kind', 'NOTES')
      .attach('file', Buffer.from('# Precios\n\nDesarrollo Web: 1500'), 'precios.md')
      .expect(201);

    expect(knowledgeService.ingestFromFile).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        kind: 'NOTES',
        source: 'precios.md',
        title: 'precios.md',
        mimeType: 'text/markdown',
      }),
    );
    expect(res.body).toEqual({ documentId: 'doc-1', status: 'indexed' });
  });

  it('honours an explicit title on upload', async () => {
    await request(app.getHttpServer())
      .post('/api/knowledge/upload')
      .field('kind', 'NOTES')
      .field('title', 'Precios LumenX')
      .attach('file', Buffer.from('# Precios'), 'precios.md')
      .expect(201);

    expect(knowledgeService.ingestFromFile).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Precios LumenX' }),
    );
  });

  it('rejects an unsupported extension with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/knowledge/upload')
      .field('kind', 'NOTES')
      .attach('file', Buffer.from('MZ'), 'malware.exe')
      .expect(400);

    expect(knowledgeService.ingestFromFile).not.toHaveBeenCalled();
  });

  it('rejects a legacy .xls pointing the user to .xlsx', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/knowledge/upload')
      .field('kind', 'NOTES')
      .attach('file', Buffer.from('legacy'), 'viejo.xls')
      .expect(400);

    expect(res.body.message).toContain('.xlsx');
    expect(knowledgeService.ingestFromFile).not.toHaveBeenCalled();
  });

  it('rejects a request without a file', async () => {
    await request(app.getHttpServer())
      .post('/api/knowledge/upload')
      .field('kind', 'NOTES')
      .expect(400);

    expect(knowledgeService.ingestFromFile).not.toHaveBeenCalled();
  });
});
