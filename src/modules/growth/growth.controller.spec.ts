import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { GrowthController } from './growth.controller';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { GrowthAdvisorService } from './growth-advisor.service';

function createAnalytics() {
  return {
    getMetrics: vi.fn().mockResolvedValue({ windowDays: 30 }),
  } as unknown as GrowthAnalyticsService;
}

function createAdvisor() {
  return {
    ask: vi.fn().mockResolvedValue({ answer: 'ok', costUsd: 0, budgetExceeded: false }),
  } as unknown as GrowthAdvisorService;
}

function makeReq(user: { businessId: string; role: string } | undefined) {
  return { user } as unknown as Request;
}

describe('GrowthController', () => {
  let controller: GrowthController;
  let analytics: ReturnType<typeof createAnalytics>;
  let advisor: ReturnType<typeof createAdvisor>;

  beforeEach(() => {
    analytics = createAnalytics();
    advisor = createAdvisor();
    controller = new GrowthController(analytics, advisor);
  });

  describe('getMetrics', () => {
    it('scopes metrics al businessId del JWT para un ADMIN', async () => {
      const result = await controller.getMetrics(makeReq({ businessId: 'biz-1', role: 'ADMIN' }));

      expect(analytics.getMetrics).toHaveBeenCalledWith('biz-1', 30);
      expect(result).toEqual({ data: { windowDays: 30 } });
    });

    it('deja que SUPER_ADMIN vea otro business vía query', async () => {
      await controller.getMetrics(
        makeReq({ businessId: 'biz-1', role: 'SUPER_ADMIN' }),
        'biz-2',
        '7',
      );

      expect(analytics.getMetrics).toHaveBeenCalledWith('biz-2', 7);
    });

    it('usa el businessId del JWT para SUPER_ADMIN sin query', async () => {
      await controller.getMetrics(makeReq({ businessId: 'biz-1', role: 'SUPER_ADMIN' }));

      expect(analytics.getMetrics).toHaveBeenCalledWith('biz-1', 30);
    });

    it('ignora businessId query para un ADMIN', async () => {
      await controller.getMetrics(makeReq({ businessId: 'biz-1', role: 'ADMIN' }), 'biz-2');

      expect(analytics.getMetrics).toHaveBeenCalledWith('biz-1', 30);
    });

    it('rechaza roles sin ADMIN/SUPER_ADMIN', async () => {
      await expect(
        controller.getMetrics(makeReq({ businessId: 'biz-1', role: 'AGENT' })),
      ).rejects.toThrow(ForbiddenException);
      expect(analytics.getMetrics).not.toHaveBeenCalled();
    });

    it('clampa days dentro de [1, 365] y usa default 30', async () => {
      await controller.getMetrics(makeReq({ businessId: 'biz-1', role: 'ADMIN' }), undefined, '0');
      expect(analytics.getMetrics).toHaveBeenLastCalledWith('biz-1', 1);

      await controller.getMetrics(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        undefined,
        '999',
      );
      expect(analytics.getMetrics).toHaveBeenLastCalledWith('biz-1', 365);

      await controller.getMetrics(
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        undefined,
        'abc',
      );
      expect(analytics.getMetrics).toHaveBeenLastCalledWith('biz-1', 30);
    });
  });

  describe('ask', () => {
    it('delega la pregunta al asesor con el businessId del JWT', async () => {
      const result = await controller.ask(
        { question: '  ¿Qué debo mejorar?  ' },
        makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
      );

      expect(advisor.ask).toHaveBeenCalledWith('biz-1', '¿Qué debo mejorar?', 30);
      expect(result.data.answer).toBe('ok');
    });

    it('rechaza preguntas vacías o solo espacios', async () => {
      await expect(
        controller.ask({ question: '   ' }, makeReq({ businessId: 'biz-1', role: 'ADMIN' })),
      ).rejects.toThrow(BadRequestException);
      expect(advisor.ask).not.toHaveBeenCalled();
    });

    it('rechaza preguntas sin texto (payload no-string)', async () => {
      await expect(
        controller.ask(
          { question: 123 as unknown as string },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza preguntas sobre el máximo de caracteres', async () => {
      await expect(
        controller.ask(
          { question: 'x'.repeat(2001) },
          makeReq({ businessId: 'biz-1', role: 'ADMIN' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza roles sin ADMIN/SUPER_ADMIN', async () => {
      await expect(
        controller.ask({ question: 'hola' }, makeReq({ businessId: 'biz-1', role: 'AGENT' })),
      ).rejects.toThrow(ForbiddenException);
      expect(advisor.ask).not.toHaveBeenCalled();
    });
  });
});
