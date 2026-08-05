import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GrowthAnalyticsService } from './growth-analytics.service';
import { GrowthAdvisorService } from './growth-advisor.service';

const DEFAULT_WINDOW_DAYS = 30;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;
const MAX_QUESTION_LENGTH = 2000;

type DashboardUser = { businessId: string; role: string };

/**
 * Endpoints de growth. SOLO accesibles con JWT y rol ADMIN/SUPER_ADMIN (el
 * agente de chat no tiene tools que los invoquen). El asesor usa un LLM
 * independiente (ANALYTICS_LLM_*) con presupuesto diario por business.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/dashboard/growth')
export class GrowthController {
  private readonly logger = new Logger(GrowthController.name);

  constructor(
    private readonly analytics: GrowthAnalyticsService,
    private readonly advisor: GrowthAdvisorService,
  ) {}

  @Get('metrics')
  async getMetrics(
    @Req() req: Request,
    @Query('businessId') businessId?: string,
    @Query('days') days?: string,
  ) {
    const user = this.assertAdmin(req.user as DashboardUser | undefined);
    const filterBusinessId =
      user.role === 'SUPER_ADMIN' ? (businessId ?? user.businessId) : user.businessId;
    if (!filterBusinessId) {
      throw new ForbiddenException('Missing businessId');
    }
    const windowDays = clampWindowDays(days);

    const metrics = await this.analytics.getMetrics(filterBusinessId, windowDays);
    return { data: metrics };
  }

  @Post('ask')
  async ask(@Body() body: { question?: string }, @Req() req: Request) {
    const user = this.assertAdmin(req.user as DashboardUser | undefined);

    const raw = body?.question;
    if (typeof raw !== 'string') {
      throw new BadRequestException('La pregunta debe ser un texto');
    }
    const question = raw.trim();
    if (!question) {
      throw new BadRequestException('La pregunta no puede estar vacía');
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      throw new BadRequestException(`La pregunta supera los ${MAX_QUESTION_LENGTH} caracteres`);
    }

    const answer = await this.advisor.ask(user.businessId, question, DEFAULT_WINDOW_DAYS);
    return { data: answer };
  }

  private assertAdmin(user: DashboardUser | undefined): DashboardUser {
    if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Requires one of: ADMIN, SUPER_ADMIN');
    }
    return user;
  }
}

function clampWindowDays(days?: string): number {
  const parsed = Number(days);
  if (!days || !Number.isFinite(parsed)) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(parsed, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}
