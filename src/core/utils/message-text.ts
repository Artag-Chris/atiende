/**
 * Extrae el texto legible del `content` de un mensaje.
 * Soporta string plano y el array de content blocks (compatible Anthropic).
 */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && block.type === 'text' ? block.text : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
