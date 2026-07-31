import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatRequest, ChatResponse, LLMProviderPort } from '@core/ports/llm-provider.port';
import type { ChatMessage, ContentBlock, ToolCall, ToolDefinition } from '@core/domain/types';
import { calculateCost, type AIConfig } from '@config/ai.config';
import { AI_CONFIG_TOKEN } from '@core/tokens';
import { extractRawFunctionCalls, stripRawFunctionCalls } from '../raw-function-calls';

@Injectable()
export class GroqAdapter implements LLMProviderPort {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    @Inject(AI_CONFIG_TOKEN) private readonly config: AIConfig,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: config.primary.timeoutMs,
      maxRetries: config.primary.maxRetries,
    });
    this.model = config.primary.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    const messages = this.translateMessages(req.messages);
    const tools = req.tools?.map((t) => this.translateTool(t));

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.systemPrompt }, ...messages],
        tools: tools?.length ? tools : undefined,
      });

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
      if (error?.status === 400 && tools?.length) {
        this.logger.warn(`[Groq] Tool call failed, retrying without tools: ${error.message}`);
        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: req.maxTokens,
          messages: [{ role: 'system', content: req.systemPrompt }, ...messages],
        });
        const choice = response.choices[0];
        const usage = {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        };
        const cost = calculateCost(this.model, usage);
        return {
          text: stripRawFunctionCalls(choice?.message?.content ?? ''),
          toolCalls: [],
          stopReason: 'end_turn',
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
          result.push({
            role: 'assistant',
            content: textContent || null,
            tool_calls: toolUseBlocks.map((b) => ({
              id: b.id,
              type: 'function' as const,
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input),
              },
            })),
          });
        } else if (textContent) {
          result.push({ role: 'assistant', content: textContent });
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
