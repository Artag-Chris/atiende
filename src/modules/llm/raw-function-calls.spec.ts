import { describe, it, expect } from 'vitest';
import { extractRawFunctionCalls, stripRawFunctionCalls } from './raw-function-calls';

describe('extractRawFunctionCalls', () => {
  it('parses the raw Groq prompt-completion format and strips it from the text', () => {
    const text = '<function.search_knowledge{"query": "factura", "limit": "5"}></function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'search_knowledge', input: { query: 'factura', limit: '5' } },
    ]);
    expect(result.cleanedText).toBe('');
  });

  it('preserves surrounding text while removing raw function calls', () => {
    const text = 'Te busco eso.<function.search_knowledge{"query": "devoluciones"}></function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('search_knowledge');
    expect(result.cleanedText).toBe('Te busco eso.');
  });

  it('supports the documented Groq `<function=name>{json}</function>` variant', () => {
    const text = '<function=create_order>{"items": [1, 2]}</function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'create_order', input: { items: [1, 2] } },
    ]);
    expect(result.cleanedText).toBe('');
  });

  it('handles nested JSON in tool arguments', () => {
    const text = '<function.filter_items>{"filter": {"price": {"lt": 100}}}</function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls[0].input).toEqual({ filter: { price: { lt: 100 } } });
    expect(result.cleanedText).toBe('');
  });

  it('parses multiple raw calls in a single response', () => {
    const text =
      '<function.search_knowledge{"query": "a"}></function><function.get_product{"id": 1}></function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((t) => t.name)).toEqual(['search_knowledge', 'get_product']);
    expect(result.toolCalls[1].id).toBe('call_2');
  });

  it('falls back to empty input when arguments are not valid JSON', () => {
    const text = '<function.search_knowledge{not-json}></function>';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'search_knowledge', input: {} }]);
    expect(result.cleanedText).toBe('');
  });

  it('prefers native tool calls and still strips raw syntax from the text', () => {
    const native = [{ id: 'call_abc', name: 'get_product', input: { id: 1 } }];
    const text = '<function.search_knowledge{"query": "x"}></function>hola';

    const result = extractRawFunctionCalls(text, native);

    expect(result.toolCalls).toEqual(native);
    expect(result.cleanedText).toBe('hola');
  });

  it('does not touch ordinary text', () => {
    const text = 'Hola, ¿tienen horario de atención?';

    const result = extractRawFunctionCalls(text, []);

    expect(result.toolCalls).toEqual([]);
    expect(result.cleanedText).toBe(text);
  });
});

describe('stripRawFunctionCalls', () => {
  it('removes raw function calls leaving only the message text', () => {
    expect(stripRawFunctionCalls('<function.a{"x":1}></function>Listo')).toBe('Listo');
  });
});
