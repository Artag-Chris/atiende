import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatRequest,
  ChatResponse,
  LLMProviderPort,
} from '@core/ports/llm-provider.port';
import type {
  ChatMessage,
  ContentBlock,
  ToolCall,
  ToolDefinition,
} from '@core/domain/types';
import { calculateCost, type AIConfig } from '@config/ai.config';

@Injectable()
export class OpenAIAdapter implements LLMProviderPort {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAIAdapter.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: AIConfig) {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: config.primary.timeoutMs,
      maxRetries: config.primary.maxRetries,
    });
    this.model = config.primary.model;
    this.timeoutMs = config.primary.timeoutMs;
    this.maxRetries = config.primary.maxRetries;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    const messages = this.translateMessages(req.messages);
    const tools = req.tools?.map((t) => this.translateTool(t));

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...messages,
      ],
      tools: tools?.length ? tools : undefined,
    });

    const choice = response.choices[0];
    const latencyMs = Date.now() - startTime;

    const text = choice.message.content ?? '';
    const toolCalls = this.extractToolCalls(choice.message);
    const stopReason = this.mapStopReason(choice.finish_reason);

    const usage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };

    const cost = calculateCost(this.model, usage);

    this.logger.log(
      `[OpenAI] ${this.model} | ${latencyMs}ms | in=${usage.inputTokens} out=${usage.outputTokens} | $${cost.totalUsd.toFixed(6)}`,
    );

    return {
      text,
      toolCalls,
      stopReason,
      usage,
      costUsd: cost.totalUsd,
      model: this.model,
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

  private translateMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        const content = this.extractTextContent(msg.content);
        if (content) {
          result.push({
            role: msg.role as 'user' | 'assistant',
            content,
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

  private extractToolCalls(
    message: OpenAI.Chat.Completions.ChatCompletionMessage,
  ): ToolCall[] {
    if (!message.tool_calls) return [];

    return message.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));
  }

  private mapStopReason(
    finishReason: string | null,
  ): ChatResponse['stopReason'] {
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
