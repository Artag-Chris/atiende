import { Logger } from '@nestjs/common';

export interface UsageMetrics {
  businessId: string;
  conversationId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  toolCallsCount: number;
  stopReason: string;
  channel: string;
}

export class UsageMetricsLogger {
  private readonly logger = new Logger('UsageMetrics');

  logTurn(metrics: UsageMetrics): void {
    this.logger.log(
      JSON.stringify({
        event: 'agent_turn',
        ...metrics,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  logToolCall(toolName: string, latencyMs: number, isError: boolean, businessId: string): void {
    this.logger.log(
      JSON.stringify({
        event: 'tool_call',
        toolName,
        latencyMs,
        isError,
        businessId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  logBudgetExceeded(businessId: string, conversationId: string, currentCost: number, limit: number): void {
    this.logger.warn(
      JSON.stringify({
        event: 'budget_exceeded',
        businessId,
        conversationId,
        currentCost,
        limit,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  logWebhookReceived(businessId: string, customerPhone: string, channel: string): void {
    this.logger.log(
      JSON.stringify({
        event: 'webhook_received',
        businessId,
        customerPhone,
        channel,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
