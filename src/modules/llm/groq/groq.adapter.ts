import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatRequest, ChatResponse, LLMProviderPort } from '@core/ports/llm-provider.port';
import type { ChatMessage, ContentBlock, ToolCall, ToolDefinition } from '@core/domain/types';
import { calculateCost, type LLMProviderConfig } from '@config/ai.config';
import { extractRawFunctionCalls } from '../raw-function-calls';

/**
 * llama-3.3-70b-versatile (y variantes prompt-completion) emiten las llamadas
 * a tools como texto `<function.NAME{json}></function>` en vez de tool_calls
 * nativos. Pasándole el parámetro `tools`, Groq intenta validar/convetir ese
 * texto y o lo filtra como texto plano (se filtra al cliente) o devuelve un
 * 400 "tool call validation failed". Por eso usamos prompt-completion: no se
 * envía `tools`, se describe el formato en el system prompt y se parsea la
 * salida con `extractRawFunctionCalls`.
 */
@Injectable()
export class GroqAdapter implements LLMProviderPort {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly config: LLMProviderConfig,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
    this.model = config.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    const messages = this.translateMessages(req.messages);
    const systemPrompt = this.buildSystemPrompt(req.systemPrompt, req.tools);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        },
        { signal: req.signal },
      );

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('Groq returned no choices (possible content filter or safety block)');
      }
      const latencyMs = Date.now() - startTime;

      const text = choice.message.content ?? '';
      const nativeToolCalls = this.extractToolCalls(choice.message);
      const { toolCalls, cleanedText } = extractRawFunctionCalls(text, nativeToolCalls);
      const stopReason = this.mapStopReason(choice.finish_reason);

      const usage = {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      const cost = calculateCost(this.model, usage);

      this.logger.log(
        `[Groq] ${this.model} | ${latencyMs}ms | in=${usage.inputTokens} out=${usage.outputTokens} | $${cost.totalUsd.toFixed(6)}`,
      );

      return {
        text: cleanedText,
        toolCalls,
        stopReason,
        usage,
        costUsd: cost.totalUsd,
        model: this.model,
      };
    } catch (raw: unknown) {
      const error = raw as { status?: number; message?: string };
      if (error?.status === 400) {
        this.logger.warn(`[Groq] 400 from API, retrying once: ${error.message}`);
        const response = await this.client.chat.completions.create(
          {
            model: this.model,
            max_tokens: req.maxTokens,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
          },
          { signal: req.signal },
        );
        const choice = response.choices[0];
        const text = choice?.message?.content ?? '';
        const nativeToolCalls = this.extractToolCalls(choice?.message);
        const { toolCalls, cleanedText } = extractRawFunctionCalls(text, nativeToolCalls);
        const usage = {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        };
        const cost = calculateCost(this.model, usage);
        return {
          text: cleanedText,
          toolCalls,
          stopReason: this.mapStopReason(choice?.finish_reason ?? null),
          usage,
          costUsd: cost.totalUsd,
          model: this.model,
        };
      }
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  private buildSystemPrompt(systemPrompt: string, tools?: ToolDefinition[]): string {
    if (!tools?.length) return systemPrompt;

    const toolList = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
    return `${systemPrompt}\n\nPara llamar a una herramienta, responde ÚNICAMENTE con la sintaxis:\n<function=nombre_de_la_tool>{"param": "valor"}</function>\nSin texto adicional. Herramientas disponibles:\n${toolList}`;
  }

  private translateMessages(
    messages: ChatMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const content = this.extractTextContent(msg.content);
        if (content) {
          result.push({ role: 'user', content });
        }
      } else if (msg.role === 'assistant') {
        const textContent = this.extractTextContent(msg.content);
        const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          const parts: string[] = [];
          if (textContent) parts.push(textContent);
          for (const block of toolUseBlocks) {
            parts.push(`<function.${block.name}>${JSON.stringify(block.input)}</function>`);
          }
          result.push({ role: 'assistant', content: parts.join('\n') });
        } else if (textContent) {
          result.push({ role: 'assistant', content: textContent });
        }
      } else if (msg.role === 'tool') {
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult) {
          result.push({
            role: 'user',
            content: `<function_results>\n${toolResult.content}\n</function_results>`,
          });
        }
      }
    }

    return result;
  }

  private extractTextContent(content: ContentBlock[]): string {
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
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
