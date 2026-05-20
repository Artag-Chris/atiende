/**
 * Tipos de dominio compartidos por el core.
 * Estos NO conocen detalles de proveedores específicos.
 */

// ============================================================================
// Conversación
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/**
 * Bloque de contenido de un mensaje. Diseñado para ser compatible con la
 * estructura de Anthropic (text blocks + tool_use + tool_result), pero
 * suficientemente abstracto para mapearse a otros providers.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      toolUseId: string;
      content: string;
      isError?: boolean;
    };

export interface ChatMessage {
  role: MessageRole;
  content: ContentBlock[];
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

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
  /** Cuántos turnos previos hay en la conversación (incluyendo este). */
  historyLength: number;
  /** True si el query del cliente contiene PII detectada (ver detectores). */
  hasPersonalInfo: boolean;
  /** True si este turno va a invocar una tool de estado (create_order, escalate). */
  involvesStatefulTool: boolean;
  /** Configuración relevante del business (slice de Business.settings). */
  businessConfig: Record<string, unknown>;
}
