import type { ToolCall } from '@core/domain/types';

const RAW_FUNCTION_OPEN_RE = /<\s*function\s*[.=:]\s*([A-Za-z_][A-Za-z0-9_-]*)\s*[>=]?\s*/g;

/**
 * Algunos modelos (p.ej. llama-3.3-70b-versatile vía Groq) no emiten
 * `tool_calls` nativos sino el formato prompt-completion:
 *   `<function.search_knowledge{"query": "factura"}></function>`
 * Si ese texto crudo llega al cliente, el cliente ve la sintaxis de la llamada
 * (bug real en producción). Este util lo parsea a ToolCall y lo elimina del
 * texto de respuesta para que el agente lo ejecute.
 */
export function extractRawFunctionCalls(
  text: string,
  nativeToolCalls: ToolCall[],
): { toolCalls: ToolCall[]; cleanedText: string } {
  if (nativeToolCalls.length > 0) {
    return { toolCalls: nativeToolCalls, cleanedText: stripRawFunctionCalls(text) };
  }

  const toolCalls: ToolCall[] = [];
  const cleaned: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  RAW_FUNCTION_OPEN_RE.lastIndex = 0;
  while ((match = RAW_FUNCTION_OPEN_RE.exec(text)) !== null) {
    const name = match[1];
    const contentStart = RAW_FUNCTION_OPEN_RE.lastIndex;
    const closeTag = text.indexOf('</function>', contentStart);
    if (closeTag === -1) break;

    cleaned.push(text.slice(lastIndex, match.index));

    const rawArgs = text.slice(contentStart, closeTag);
    const openBrace = rawArgs.indexOf('{');
    const closeBrace = rawArgs.lastIndexOf('}');
    let input: Record<string, unknown> = {};
    if (openBrace !== -1 && closeBrace > openBrace) {
      try {
        input = JSON.parse(rawArgs.slice(openBrace, closeBrace + 1)) as Record<string, unknown>;
      } catch {
        input = {};
      }
    }
    toolCalls.push({ id: `call_${toolCalls.length + 1}`, name, input });

    lastIndex = closeTag + '</function>'.length;
    RAW_FUNCTION_OPEN_RE.lastIndex = lastIndex;
  }

  cleaned.push(text.slice(lastIndex));
  return { toolCalls, cleanedText: cleaned.join('').trim() };
}

export function stripRawFunctionCalls(text: string): string {
  return extractRawFunctionCalls(text, []).cleanedText;
}
