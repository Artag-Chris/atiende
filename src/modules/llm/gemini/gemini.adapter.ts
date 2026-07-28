import { Inject, Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ChatRequest, ChatResponse, LLMProviderPort } from '@core/ports/llm-provider.port';
import type { ChatMessage, ContentBlock, ToolCall, ToolDefinition } from '@core/domain/types';
import { calculateCost, type AIConfig } from '@config/ai.config';
import { AI_CONFIG_TOKEN } from '@core/tokens';

@Injectable()
export class GeminiAdapter implements LLMProviderPort {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;

  constructor(@Inject(AI_CONFIG_TOKEN) private readonly config: AIConfig) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.config.primary.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const startTime = Date.now();

    const systemInstruction = req.systemPrompt;
    const history = this.translateMessages(req.messages.slice(0, -1));
    const tools = req.tools?.map((t) => this.translateTool(t));

    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools?.length ? [{ functionDeclarations: tools as any }] : undefined,
    });

    const chat = generativeModel.startChat({ history });
    const lastUserMessage = req.messages[req.messages.length - 1];
    const userText = this.extractTextContent(lastUserMessage.content);

    const result = await chat.sendMessage(userText);
    const response = result.response;
    const latencyMs = Date.now() - startTime;

    const text = response.text() ?? '';
    const usageMetadata = response.usageMetadata;
    const toolCalls = this.extractToolCalls(response);
    const stopReason = this.mapStopReason(response);

    const usage = {
      inputTokens: usageMetadata?.promptTokenCount ?? 0,
      outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };

    const cost = calculateCost(this.model, usage);

    this.logger.log(
      `[Gemini] ${this.model} | ${latencyMs}ms | in=${usage.inputTokens} out=${usage.outputTokens} | $${cost.totalUsd.toFixed(6)}`,
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
      const model = this.genAI.getGenerativeModel({ model: this.model });
      await model.generateContent('ping');
      return true;
    } catch {
      return false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private translateMessages(
    messages: ChatMessage[],
  ): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = this.extractTextContent(msg.content);
        if (text) {
          result.push({ role: 'user', parts: [{ text }] });
        }
      } else if (msg.role === 'assistant') {
        const textContent = this.extractTextContent(msg.content);
        const toolUseBlocks = msg.content.filter((b) => b.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          const parts: Array<{ text: string } | { functionCall: Record<string, unknown> }> = [];
          if (textContent) {
            parts.push({ text: textContent });
          }
          for (const b of toolUseBlocks) {
            parts.push({
              functionCall: {
                name: b.name,
                args: b.input,
              },
            });
          }
          result.push({ role: 'model', parts });
        } else if (textContent) {
          result.push({ role: 'model', parts: [{ text: textContent }] });
        }
      } else if (msg.role === 'tool') {
        const toolResult = msg.content.find((b) => b.type === 'tool_result');
        if (toolResult) {
          result.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: toolResult.toolUseId.split('_').slice(0, -1).join('_') || 'unknown',
                  response: { result: toolResult.content },
                },
              },
            ],
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

  private translateTool(tool: ToolDefinition) {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractToolCalls(response: any): ToolCall[] {
    const functionCalls = response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) return [];

    return functionCalls.map((fc: { name: string; args: Record<string, unknown> }) => ({
      id: fc.name,
      name: fc.name,
      input: fc.args,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapStopReason(response: any): ChatResponse['stopReason'] {
    const finishReason = response.candidates?.[0]?.finishReason;
    switch (finishReason) {
      case 'MAX_TOKENS':
        return 'max_tokens';
      case 'SAFETY':
      case 'RECITATION':
        return 'refusal';
      default:
        return 'end_turn';
    }
  }
}
