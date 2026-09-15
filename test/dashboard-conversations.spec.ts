import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { DashboardController } from '@modules/dashboard/dashboard.controller';
import { JwtAuthGuard } from '@modules/auth/jwt-auth.guard';
import { CONVERSATION_REPOSITORY_TOKEN, MESSAGE_REPOSITORY_TOKEN } from '@core/tokens';

/**
 * Verifica la superficie HTTP real de la exploradora de chats: que
 * `GET /conversations` no sea capturada por `GET /conversations/:id`, que el
 * guard aplique y que la validación de query responda 400.
 */
describe('DashboardController (HTTP)', () => {
  let app: INestApplication;

  const conversationRepo = {
    findAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findById: vi.fn(),
  };
  const messageRepo = {
    findPage: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
    findRecent: vi.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: CONVERSATION_REPOSITORY_TOKEN, useValue: conversationRepo },
        { provide: MESSAGE_REPOSITORY_TOKEN, useValue: messageRepo },
      ],
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('routes GET /api/dashboard/conversations to the list endpoint', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard/conversations?status=active,resolved&channel=whatsapp&limit=10&offset=5')
      .expect(200);

    expect(conversationRepo.findAll).toHaveBeenCalledWith('biz-1', {
      statuses: ['ACTIVE', 'RESOLVED'],
      channel: 'whatsapp',
      search: undefined,
      limit: 10,
      offset: 5,
    });
    expect(res.body).toEqual({ data: [], total: 0, limit: 10, offset: 5 });
  });

  it('routes GET /api/dashboard/conversations/:id to the detail endpoint', async () => {
    conversationRepo.findById.mockResolvedValueOnce({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'whatsapp',
      customerIdentifier: '573001234567',
      status: 'ACTIVE',
    });

    const res = await request(app.getHttpServer())
      .get('/api/dashboard/conversations/conv-1?limit=10')
      .expect(200);

    expect(messageRepo.findPage).toHaveBeenCalledWith('conv-1', {
      before: undefined,
      limit: 10,
    });
    expect(res.body).toEqual({
      conversation: expect.objectContaining({ id: 'conv-1' }),
      messages: [],
      hasMore: false,
    });
  });

  it('rejects an unparseable before cursor with 400', async () => {
    conversationRepo.findById.mockResolvedValueOnce({
      id: 'conv-1',
      businessId: 'biz-1',
      channel: 'whatsapp',
      customerIdentifier: 'x',
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .get('/api/dashboard/conversations/conv-1?before=not-a-date')
      .expect(400);
  });
});
