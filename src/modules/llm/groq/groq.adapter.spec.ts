import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AIConfig } from '@config/ai.config';
import { GroqAdapter } from './groq.adapter';
import type { ChatRequest } from '@core/ports/llm-provider.port';
import type { ToolDefinition } from '@core/domain/types';

const { openaiClientMock, openaiCtorMock } = vi.hoisted(() => {
  const create = vi.fn();
  const openaiClientMock = { chat: { completions: { create } } };
  const openaiCtorMock = vi.fn(() => openaiClientMock);
  return { openaiClientMock, openaiCtorMock };
});

vi.mock('openai', () => ({ __esModule: true, default: openaiCtorMock }));

function makeConfig(): AIConfig {
  return {
    primary: {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      maxTokens: 1024,
      timeoutMs: 30000,
      maxRetries: 2,
    },
    fallback: {
      provider: 'mock',
      model: 'mock-1',
      maxTokens: 512,
      timeoutMs: 30000,
      maxRetries: 0,
    },
    agent: { maxToolIterations: 3, budgetUsdPerConversation: 0 },
    cache: { minPromptCacheTokens: 0 },
  } as unknown as AIConfig;
}

function makeConfigService(): ConfigService {
  return { get: vi.fn().mockReturnValue('test-key') } as unknown as ConfigService;
}

function makeTools(): ToolDefinition[] {
  return [
    {
      name: 'escalate_to_human',
      description: 'Escala la conversación a un humano del equipo del negocio.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
}

describe('GroqAdapter', () => {
  let adapter: GroqAdapter;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openaiCtorMock.mockClear();
    create = openaiClientMock.chat.completions.create;
    create.mockClear();
    adapter = new GroqAdapter(makeConfig(), makeConfigService());
  });

  it('does not send the tools parameter (prompt-completion mode)', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Hola' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const req: ChatRequest = {
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: makeTools(),
      maxTokens: 1024,
    };
    await adapter.chat(req);

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.tools).toBeUndefined();
    expect(payload.model).toBe('llama-3.3-70b-versatile');
  });

  it('augments the system prompt with the tool-call format and tool list', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Hola' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const req: ChatRequest = {
      systemPrompt: 'System base',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: makeTools(),
      maxTokens: 1024,
    };
    await adapter.chat(req);

    const payload = create.mock.calls[0][0];
    const system = payload.messages[0].content;
    expect(system).toContain('System base');
    expect(system).toContain('<function=nombre_de_la_tool>');
    expect(system).toContain('- escalate_to_human:');
  });

  it('parses raw prompt-completion tool calls and strips them from the text', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: '<function.escalate_to_human>{"reason": "quiere humano"}</function>',
            tool_calls: null,
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'escalame' }] }],
      tools: makeTools(),
      maxTokens: 1024,
    });

    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'escalate_to_human', input: { reason: 'quiere humano' } },
    ]);
    expect(result.text).toBe('');
  });

  it('translates assistant tool_use history into the raw text format', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Listo', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    });

    await adapter.chat({
      systemPrompt: 'System',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'busca' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_x',
              name: 'escalate_to_human',
              input: { reason: 'x' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            { type: 'tool_result', toolUseId: 'call_x', content: '{"status":"escalated"}' },
          ],
        },
      ],
      tools: makeTools(),
      maxTokens: 1024,
    });

    const sent: Array<{ role: string; content?: string | null }> = create.mock.calls[0][0].messages;
    const assistantMsg = sent.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toContain(
      '<function.escalate_to_human>{"reason":"x"}</function>',
    );
    const toolMsg = sent.find((m) => m.role === 'user' && m.content?.includes('function_results'));
    expect(toolMsg?.content).toContain('{"status":"escalated"}');
  });

  it('retries once on 400 and still parses raw tool calls', async () => {
    create
      .mockRejectedValueOnce({ status: 400, message: 'tool call validation failed' })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '<function.escalate_to_human>{"reason": "x"}</function>',
              tool_calls: null,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'escalame' }] }],
      tools: makeTools(),
      maxTokens: 1024,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.toolCalls[0].name).toBe('escalate_to_human');
    expect(result.text).toBe('');
  });
});
