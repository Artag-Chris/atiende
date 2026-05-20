import type { ToolDefinition, TurnContext } from '../domain/types';

/**
 * Resultado de la ejecución de una tool del agente.
 * Se devuelve al modelo como tool_result.
 */
export interface ToolExecutionResult {
  /** Output serializado que el modelo va a leer (JSON o texto). */
  output: string;
  /** True si la ejecución falló (el modelo verá is_error=true). */
  isError?: boolean;
  /** Metadata para telemetría (no se le pasa al modelo). */
  meta?: {
    latencyMs?: number;
    rowsAffected?: number;
    [key: string]: unknown;
  };
}

/**
 * Port para una tool del agente.
 * Cada tool es un módulo independiente en src/modules/tools/<name>/.
 *
 * Reglas:
 *  - La descripción es lo más importante (el modelo decide cuándo llamarla basado en eso).
 *  - El input se valida ANTES de ejecutar.
 *  - business_id NUNCA viene del modelo: se pasa por TurnContext.
 *  - Si la tool muta estado, debe marcarse mutatesState=true para que el cache la respete.
 */
export interface ToolModulePort {
  /** Nombre que el agente verá (ej: 'search_catalog', 'create_order'). */
  readonly name: string;

  /** Definición serializable que se le pasa al LLM provider. */
  getDefinition(): ToolDefinition;

  /**
   * Si true, esta tool MUTA estado del business (crea órdenes, escala, etc.).
   * Turnos que invocan tools mutates=true NO pueden cachearse.
   */
  readonly mutatesState: boolean;

  /** Ejecuta la tool con el input parseado y el contexto del turno. */
  execute(input: Record<string, unknown>, ctx: TurnContext): Promise<ToolExecutionResult>;
}
