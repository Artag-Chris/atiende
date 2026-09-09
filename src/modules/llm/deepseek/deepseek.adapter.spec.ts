import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AIConfig } from '@config/ai.config';
import { DeepSeekAdapter } from './deepseek.adapter';
import type { ChatRequest } from '@core/ports/llm-provider.port';
import type { ToolDefinition } from '@core/domain/types';

const { openaiClientMock, openaiCtorMock } = vi.hoisted(() => {
  const create = vi.fn();
  const openaiClientMock = { chat: { completions: { create } } };
  const openaiCtorMock = vi.fn((..._args: unknown[]) => openaiClientMock);
  return { openaiClientMock, openaiCtorMock };
});

vi.mock('openai', () => ({ __esModule: true, default: openaiCtorMock }));

function makeConfig(): AIConfig {
  return {
    primary: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      maxTokens: 1024,
      timeoutMs: 60000,
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

function makeConfigService(apiKey = 'test-key'): ConfigService {
  return { get: vi.fn().mockReturnValue(apiKey) } as unknown as ConfigService;
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

describe('DeepSeekAdapter', () => {
  let adapter: DeepSeekAdapter;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openaiCtorMock.mockClear();
    create = openaiClientMock.chat.completions.create;
    create.mockClear();
    adapter = new DeepSeekAdapter(makeConfig().primary, makeConfigService());
  });

  it('throws if DEEPSEEK_API_KEY is not configured', () => {
    expect(() => new DeepSeekAdapter(makeConfig().primary, makeConfigService(''))).toThrow(
      'DEEPSEEK_API_KEY not configured',
    );
  });

  it('configures the OpenAI client against the DeepSeek base URL', () => {
    expect(openaiCtorMock).toHaveBeenCalledTimes(1);
    const clientArgs = openaiCtorMock.mock.calls[0][0] as { baseURL?: string };
    expect(clientArgs.baseURL).toBe('https://api.deepseek.com');
  });

  it('sends the native tools parameter and uses the DeepSeek model', async () => {
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
    expect(payload.tools).toBeDefined();
    expect(payload.tools[0].function.name).toBe('escalate_to_human');
    expect(payload.model).toBe('deepseek-v4-flash');
  });

  it('parses native tool_calls from the response', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'escalate_to_human',
                  arguments: '{"reason": "quiere humano"}',
                },
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

  it('translates assistant tool_use history into native tool_calls', async () => {
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
    expect(assistantMsg?.content).toBeNull();
    const toolMsg = sent.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('{"status":"escalated"}');
  });

  it('tracks cache-read tokens from DeepSeek usage details', async () => {
    create.mockResolvedValue({
      choices: [{ message: { content: 'hola' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
      maxTokens: 1024,
    });

    expect(result.usage.cacheReadInputTokens).toBe(40);
  });

  it('retries once on 400', async () => {
    create.mockRejectedValueOnce({ status: 400, message: 'bad request' }).mockResolvedValueOnce({
      choices: [{ message: { content: 'ok', tool_calls: null }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await adapter.chat({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ok' }] }],
      maxTokens: 1024,
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('ok');
  });
});
