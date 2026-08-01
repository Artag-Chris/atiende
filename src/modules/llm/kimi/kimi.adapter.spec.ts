import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AIConfig } from '@config/ai.config';
import { KimiAdapter } from './kimi.adapter';
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
      provider: 'kimi',
      model: 'kimi-k3',
      effort: 'medium',
      maxTokens: 1024,
      timeoutMs: 30000,
      maxRetries: 2,
    },
    fallback: {
      provider: 'mock',
      model: 'mock-1',
      effort: 'medium',
      maxTokens: 512,
      timeoutMs: 30000,
      maxRetries: 0,
    },
    promptCaching: { enabled: true, defaultTtl: '5m', minTokensToCache: 0 },
    compaction: { enabled: true, triggerTokenThreshold: 50000 },
    adaptiveThinking: false,
    agent: {
      maxToolIterations: 3,
      maxConversationTokens: 50000,
      budgetUsdPerConversation: 0,
      targetLatencyP95Ms: 5000,
    },
  } as unknown as AIConfig;
}

function makeConfigService(): ConfigService {
  return { get: vi.fn().mockReturnValue('test-key') } as unknown as ConfigService;
}

function makeConfigServiceWithoutKey(): ConfigService {
  return { get: vi.fn().mockReturnValue(undefined) } as unknown as ConfigService;
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

describe('KimiAdapter', () => {
  let adapter: KimiAdapter;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openaiCtorMock.mockClear();
    create = openaiClientMock.chat.completions.create;
    create.mockClear();
    adapter = new KimiAdapter(makeConfig().primary, makeConfigService());
  });

  it('throws at construction when KIMI_API_KEY is missing', () => {
    expect(() => new KimiAdapter(makeConfig().primary, makeConfigServiceWithoutKey())).toThrow(
      'KIMI_API_KEY not configured',
    );
  });

  it('sends native tools, the kimi-k3 model and max_completion_tokens', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Hola', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const req: ChatRequest = {
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      tools: makeTools(),
      maxTokens: 1024,
      effort: 'low',
    };
    await adapter.chat(req);

    const payload = create.mock.calls[0][0];
    expect(payload.model).toBe('kimi-k3');
    expect(payload.max_completion_tokens).toBe(1024);
    expect(payload.tools).toHaveLength(1);
    expect(payload.reasoning_effort).toBe('max');
  });

  it('extracts reasoning_content into reasoningContent', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Respuesta final',
            tool_calls: null,
            reasoning_content: 'Razonamiento interno del modelo',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      maxTokens: 1024,
    });

    expect(result.reasoningContent).toBe('Razonamiento interno del modelo');
  });

  it('re-sends reasoning_content on assistant history for tool-loop continuity', async () => {
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
          reasoning: 'Pensando qué tool usar',
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

    const sent = create.mock.calls[0][0].messages as Array<{
      role: string;
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{ id: string }>;
    }>;
    const assistantMsg = sent.find((m) => m.role === 'assistant');
    expect(assistantMsg?.reasoning_content).toBe('Pensando qué tool usar');
    expect(assistantMsg?.content).toBeNull();
    expect(assistantMsg?.tool_calls).toHaveLength(1);
  });

  it('maps cached tokens to cacheReadInputTokens and discounts them from input', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Hola', tool_calls: null }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 500,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens: 30,
      },
    });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      maxTokens: 1024,
    });

    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.cacheReadInputTokens).toBe(200);
  });

  it('parses native tool calls into ToolCall', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'escalate_to_human', arguments: '{"reason":"quiere humano"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
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
    expect(result.stopReason).toBe('tool_use');
  });

  it('forwards the request signal to the SDK', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Hola', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    });

    const controller = new AbortController();
    await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      maxTokens: 1024,
      signal: controller.signal,
    });

    expect(create.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('retries once on 400 and returns the retried response', async () => {
    create
      .mockRejectedValueOnce({ status: 400, message: 'invalid reasoning history' })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'Listo', tool_calls: null }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      maxTokens: 1024,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Listo');
  });

  it('does not retry on non-400 errors', async () => {
    create.mockRejectedValueOnce({ status: 429, message: 'rate limited' });

    await expect(
      adapter.chat({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
        maxTokens: 1024,
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('truncates reasoning_content to the last portion on re-send', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'Listo', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 4 },
    });

    const longReasoning = 'pensando '.repeat(500);
    await adapter.chat({
      systemPrompt: 'System',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'busca' }] },
        {
          role: 'assistant',
          reasoning: longReasoning,
          content: [{ type: 'tool_use', id: 'call_x', name: 'escalate_to_human', input: {} }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolUseId: 'call_x', content: '{}' }],
        },
      ],
      tools: makeTools(),
      maxTokens: 1024,
    });

    const sent = create.mock.calls[0][0].messages as Array<{
      role?: string;
      reasoning_content?: string;
    }>;
    const assistantMsg = sent.find((m) => m.role === 'assistant');
    expect(assistantMsg?.reasoning_content).toBe(longReasoning.slice(-2000));
  });
});
