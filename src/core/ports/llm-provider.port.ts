import type {
  ChatMessage,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '../domain/types';

/**
 * Hint para el adapter sobre el nivel de razonamiento deseado.
 * Cada provider lo mapea a su parámetro nativo:
 *   - Claude: output_config.effort (xhigh: Opus 4.7 only; max: Opus only)
 *   - OpenAI: ignored o mapeado a reasoning_effort (solo o-series)
 *   - Kimi K3: mapeado a reasoning_effort (actualmente solo soporta 'max';
 *     cualquier otro valor degrada a 'max' en silencio)
 *   - Local: ignored
 *
 * Trade-off provider-agnostic: si pides 'max' y el provider no lo soporta,
 * el adapter degrada a 'high' silenciosamente.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
  /**
   * Forzar el uso de una tool específica. Provider-specific: si el adapter
   * no lo soporta, lo ignora silenciosamente.
   */
  forceTool?: string;
  /**
   * Para cancelar el request (timeout customizado, request del cliente cancelada).
   * Cada adapter debe respetarlo y abortar la llamada HTTP cuando se dispare.
   */
  signal?: AbortSignal;
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
  /**
   * Texto de razonamiento del modelo (p.ej. reasoning_content de Kimi K3).
   * Provider-specific: si el adapter no lo soporta, lo omite. El core puede
   * propagarlo a la siguiente iteración del tool loop vía ChatMessage.reasoning.
   */
  reasoningContent?: string;
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
