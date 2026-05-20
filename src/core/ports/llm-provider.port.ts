import type {
  ChatMessage,
  StopReason,
  ToolCall,
  ToolDefinition,
  TokenUsage,
} from '../domain/types';

/**
 * Hint para el adapter sobre el nivel de razonamiento deseado.
 * Cada provider lo mapea a su parámetro nativo:
 *   - Claude: output_config.effort
 *   - OpenAI: ignored or mapped to reasoning_effort (o-series only)
 *   - Local: ignored
 */
export type Effort = 'low' | 'medium' | 'high';

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /**
   * Hint provider-agnostic: este request es un buen candidato a caching.
   * Cada adapter decide qué hacer (Claude: cache_control; OpenAI: ignora porque es automático; etc).
   * Ver docs/01_ARCHITECTURE.md §11.3.
   */
  cacheable?: boolean;
  effort?: Effort;
  maxTokens: number;
  /** Forzar el uso de una tool específica (provider may or may not support). */
  forceTool?: string;
}

export interface ChatResponse {
  /** Concatenación de los content blocks de texto de la respuesta. */
  text: string;
  /** Tool calls que el modelo emitió en este turno. */
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  /** Costo en USD calculado por el adapter según el pricing del provider. */
  costUsd: number;
  /** Nombre del modelo usado (puede no ser el solicitado si el adapter ruteó). */
  model: string;
}

/**
 * Port del proveedor de LLM. El core habla con esta interfaz, nunca con
 * SDKs de proveedores específicos. Implementaciones en src/modules/llm/<provider>/.
 *
 * Ver docs/01_ARCHITECTURE.md §11.3 para el detalle de qué se abstrae y qué no.
 */
export interface LLMProviderPort {
  /** Identificador del provider: 'claude' | 'openai' | 'mock' | ... */
  readonly name: string;

  /** Una llamada de chat con posible tool use. */
  chat(req: ChatRequest): Promise<ChatResponse>;

  /** Health check ligero, usado por el circuit breaker. */
  isHealthy(): Promise<boolean>;
}
