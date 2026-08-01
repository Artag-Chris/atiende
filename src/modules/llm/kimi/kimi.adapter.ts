import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatRequest,
  ChatResponse,
  Effort,
  LLMProviderPort,
} from '@core/ports/llm-provider.port';
import type { ChatMessage, ContentBlock, ToolCall, ToolDefinition } from '@core/domain/types';
import { calculateCost, type LLMProviderConfig } from '@config/ai.config';
import { extractRawFunctionCalls } from '../raw-function-calls';

/**
 * Mensaje OpenAI-compatible con el campo específico de Moonshot
 * `reasoning_content` (necesario para reenviar el razonamiento de K3).
 */
type KimiChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam & {
  reasoning_content?: string;
};

/**
 * Longitud máxima del reasoning reenviado en mensajes assistant del tool loop.
 * Moonshot acepta reasoning recortado a la parte final; reenviarlo completo
 * infla el input de cada iteración.
 */
const MAX_REASONING_CHARS = 2000;

/**
 * Kimi K3 (Moonshot AI) — API OpenAI-compatible vía https://api.moonshot.ai/v1.
 *
 * Peculiaridades de K3:
 *  - Es un modelo de razonamiento: SIEMPRE razona (thinking). El parámetro
 *    `reasoning_effort` solo soporta oficialmente 'max'; cualquier otro valor
 *    se degrada a 'max' en silencio.
 *  - Usa `max_completion_tokens` (no `max_tokens`) y sampling fijo (no se
 *    envía temperature).
 *  - Requiere reenviar `reasoning_content` (recortado a la última parte
 *    razonada) y `tool_calls` completos en los mensajes assistant entre
 *    iteraciones del tool loop; si no, el historial se rechaza.
 *  - El caching es automático: `prompt_tokens_details.cached_tokens` se
 *    factura a tarifa reducida (se resta de inputTokens para el cálculo).
 */
@Injectable()
export class KimiAdapter implements LLMProviderPort {
  readonly name = 'kimi';
  private readonly logger = new Logger(KimiAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly config: LLMProviderConfig,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('KIMI_API_KEY');
    if (!apiKey) {
      throw new Error('KIMI_API_KEY not configured');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.moonshot.ai/v1',
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
    this.model = config.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    const messages = this.translateMessages(req.messages);
    const tools = req.tools?.map((t) => this.translateTool(t));

    try {
      return await this.complete(messages, tools, req, startTime);
    } catch (raw: unknown) {
      const error = raw as { status?: number; message?: string };
      if (error?.status === 400) {
        this.logger.warn(`[Kimi] 400 from API, retrying once: ${error.message}`);
        return await this.complete(messages, tools, req, startTime);
      }
      throw error;
    }
  }

  private async complete(
    messages: KimiChatMessage[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
    req: ChatRequest,
    startTime: number,
  ): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        max_completion_tokens: req.maxTokens,
        reasoning_effort: this.mapReasoningEffort(req.effort) as never,
        messages: [{ role: 'system', content: req.systemPrompt }, ...messages],
        tools: tools?.length ? tools : undefined,
      },
      { signal: req.signal },
    );

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('Kimi returned no choices (possible content filter or safety block)');
    }
    const latencyMs = Date.now() - startTime;

    const text = choice.message.content ?? '';
    const nativeToolCalls = this.extractToolCalls(choice.message);
    const { toolCalls, cleanedText } = extractRawFunctionCalls(text, nativeToolCalls);
    const stopReason = this.mapStopReason(choice.finish_reason);

    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const creationTokens =
      (response.usage?.prompt_tokens_details as { cache_creation_input_tokens?: number })
        ?.cache_creation_input_tokens ?? 0;

    const usage = {
      inputTokens: Math.max(0, (response.usage?.prompt_tokens ?? 0) - cachedTokens),
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadInputTokens: cachedTokens,
      cacheCreationInputTokens: creationTokens,
    };

    const cost = calculateCost(this.model, usage);

    this.logger.log(
      `[Kimi] ${this.model} | ${latencyMs}ms | in=${usage.inputTokens} cached=${cachedTokens} out=${usage.outputTokens} | $${cost.totalUsd.toFixed(6)}`,
    );

    return {
      text: cleanedText,
      toolCalls,
      stopReason,
      usage,
      costUsd: cost.totalUsd,
      model: this.model,
      reasoningContent: (choice.message as { reasoning_content?: string }).reasoning_content,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private mapReasoningEffort(effort?: Effort): 'max' {
    if (effort && effort !== 'max') {
      this.logger.debug(`[Kimi] effort "${effort}" not supported by kimi-k3, degrading to "max"`);
    }
    return 'max';
  }

  private translateMessages(messages: ChatMessage[]): KimiChatMessage[] {
    const result: KimiChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = this.extractTextContent(msg.content);
        if (content) {
          result.push({ role: 'user', content });
        }
      } else if (msg.role === 'assistant') {
        const textContent = this.extractTextContent(msg.content);
        const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');
        const reasoning = this.truncateReasoning(msg.reasoning);
        if (toolUseBlocks.length > 0) {
          result.push({
            role: 'assistant',
            content: textContent || null,
            reasoning_content: reasoning,
            tool_calls: toolUseBlocks.map((b) => ({
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            })),
          });
        } else if (textContent || reasoning) {
          result.push({ role: 'assistant', content: textContent, reasoning_content: reasoning });
        }
      } else if (msg.role === 'tool') {
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult) {
          result.push({
            role: 'tool',
            tool_call_id: toolResult.toolUseId,
            content: toolResult.content,
          });
        }
      }
    }

    return result;
  }

  private truncateReasoning(reasoning?: string): string | undefined {
    if (!reasoning) return undefined;
    return reasoning.length > MAX_REASONING_CHARS
      ? reasoning.slice(reasoning.length - MAX_REASONING_CHARS)
      : reasoning;
  }

  private extractTextContent(content: ContentBlock[]): string {
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private translateTool(tool: ToolDefinition): OpenAI.Chat.Completions.ChatCompletionTool {
    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    };
  }

  private extractToolCalls(message: OpenAI.Chat.Completions.ChatCompletionMessage): ToolCall[] {
    if (!message.tool_calls) return [];

    return message.tool_calls.map((tc) => {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        this.logger.warn(
          `Failed to parse tool arguments for ${tc.function.name}: ${tc.function.arguments}`,
        );
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    });
  }

  private mapStopReason(finishReason: string | null): ChatResponse['stopReason'] {
    switch (finishReason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'other';
    }
  }
}
