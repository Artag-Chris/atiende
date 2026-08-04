import type { Channel } from '../domain/types';

/**
 * Agregaciones crudas del asesor de growth, tal cual salen del repositorio.
 * Los cálculos derivados (tasas, promedios) los hace GrowthAnalyticsService.
 */
export interface GrowthRawAnalytics {
  conversationsTotal: number;
  conversationsByChannel: Array<{ channel: Channel; count: number }>;
  /** Mensajes entrantes (role USER) por día, 'YYYY-MM-DD'. Base de tendencias. */
  dailyUserMessages: Array<{ day: string; count: number }>;
  messagesTotal: number;
  userMessagesTotal: number;
  quotesByStatus: Array<{ status: string; count: number }>;
  quotesTotal: number;
  quoteTotalUsd: number;
  /** Servicios cotizados (parse del JSON services de Quote), agregados. */
  topServices: Array<{ service: string; quotes: number; totalUsd: number }>;
  callRequestsTotal: number;
  llmCostUsd: number;
  llmRuns: number;
  cacheEntries: number;
  cacheHits: number;
}

/** KPIs listos para el dashboard y para el prompt del asesor. */
export interface GrowthMetrics {
  windowDays: number;
  since: string;
  conversationsTotal: number;
  conversationsByChannel: Array<{ channel: Channel; count: number }>;
  dailyUserMessages: Array<{ day: string; count: number }>;
  messagesTotal: number;
  userMessagesTotal: number;
  quotesTotal: number;
  quotesSent: number;
  quotesAccepted: number;
  /** 0..1 (accepteds / sent, con guard de división por cero). */
  quoteConversionRate: number;
  averageQuoteUsd: number;
  topServices: Array<{ service: string; quotes: number; totalUsd: number }>;
  callRequestsTotal: number;
  llmCostUsd: number;
  llmRuns: number;
  /** 0..1: hits / (hits + entries usadas en la ventana). */
  cacheHitRate: number;
  cacheEntries: number;
  cacheHits: number;
}

export interface GrowthAnalyticsRepositoryPort {
  /**
   * Agregaciones del business en la ventana [since, ahora]. Todas tenant-scoped
   * por businessId.
   */
  getAnalytics(businessId: string, since: Date): Promise<GrowthRawAnalytics>;
}
