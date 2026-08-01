/**
 * Tipos de dominio compartidos por el core.
 * Estos NO conocen detalles de proveedores específicos.
 */

// ============================================================================
// Conversación
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Canal por el que llega/sale un mensaje. Única fuente de verdad del core.
 * Los repositorios mapean a los enums de Prisma (WHATSAPP/WEB_CHAT/...).
 */
export type Channel = 'whatsapp' | 'web_chat' | 'telegram' | 'instagram' | 'messenger';

/**
 * Invocación de una tool por el agente.
 * Comparte forma con el bloque de contenido `tool_use` para evitar duplicación.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Resultado de una tool, devuelto al modelo como tool_result block.
 */
export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * Bloque de contenido de un mensaje. Diseñado para ser compatible con la
 * estructura de Anthropic (text blocks + tool_use + tool_result), pero
 * suficientemente abstracto para mapearse a otros providers.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | ({ type: 'tool_use' } & ToolCall)
  | ({ type: 'tool_result' } & ToolResult);

export interface ChatMessage {
  role: MessageRole;
  content: ContentBlock[];
  /**
   * Texto de razonamiento del provider (p.ej. el reasoning_content de Kimi K3).
   * Solo los adapters que lo soporten lo rellenan; el resto lo ignora.
   * Necesario para devolvérselo al modelo en la siguiente iteración del tool
   * loop (K3 exige reenviar reasoning_content en los mensajes assistant).
   */
  reasoning?: string;
}

// ============================================================================
// Tool definition (lo que el agente puede llamar)
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema del input. Lo más simple: derivado desde Zod por el módulo. */
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Stop reason normalizado entre providers
// ============================================================================

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'refusal'
  | 'pause_turn'
  | 'other';

// ============================================================================
// Token usage normalizado
// ============================================================================

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens leídos del cache del provider (Anthropic prompt caching). 0 si no aplica. */
  cacheReadInputTokens: number;
  /** Tokens escritos al cache del provider en este request. 0 si no aplica. */
  cacheCreationInputTokens: number;
}

// ============================================================================
// Contexto del turno (para pasar a tools, cache, etc.)
// ============================================================================

export interface TurnContext {
  businessId: string;
  conversationId: string;
  customerPhone: string;
  /** Canal por el que llega este turno (necesario para multi-channel). */
  channel: Channel;
  /** Cuántos turnos previos hay en la conversación (incluyendo este). */
  historyLength: number;
  /** True si el query del cliente contiene PII detectada (ver detectores). */
  hasPersonalInfo: boolean;
  /**
   * Predicción ANTES de llamar al LLM de si este turno podría involucrar una
   * tool de estado. Usado por el response cache para decidir bypass.
   * Decisión final post-LLM la toma el AgentService verificando los tool_calls reales.
   */
  mayInvolveStatefulTool: boolean;
  /** Configuración relevante del business (slice immutable de Business.settings). */
  businessConfig: Readonly<Record<string, unknown>>;
}
