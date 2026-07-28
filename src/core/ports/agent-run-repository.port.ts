/**
 * Port para persistencia de telemetría del agente.
 * Cada ejecución del agente (turno) se guarda para métricas de costo, latencia y calidad.
 */
export interface AgentRunData {
  businessId: string;
  conversationId: string;
  model: string;
  llmProvider: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costUsd: number;
  toolCalls?: Record<string, unknown>[];
  stopReason?: string;
}

export interface AgentRunRepositoryPort {
  save(data: AgentRunData): Promise<void>;
  getConversationCost(conversationId: string): Promise<number>;
}
