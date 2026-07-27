import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LLMProviderPort } from '@core/ports/llm-provider.port';
import { LLM_PROVIDER_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';
import { AI_CONFIG_TOKEN } from '@core/tokens';

export interface AgentInput {
  systemPrompt: string;
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentOutput {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  costUsd: number;
  latencyMs: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LLMProviderPort,
    @Inject(AI_CONFIG_TOKEN) private readonly config: AIConfig,
  ) {}

  async runTurn(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();

    const messages = [
      ...(input.conversationHistory ?? []).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: [{ type: 'text' as const, text: m.content }],
      })),
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: input.userMessage }],
      },
    ];

    const response = await this.llm.chat({
      systemPrompt: input.systemPrompt,
      messages,
      maxTokens: this.config.primary.maxTokens,
    });

    const latencyMs = Date.now() - startTime;

    this.logger.log(
      `[Agent] Turn completed: ${latencyMs}ms | model=${response.model} | tokens=${response.usage.inputTokens}+${response.usage.outputTokens} | $${response.costUsd.toFixed(6)}`,
    );

    return {
      text: response.text,
      model: response.model,
      usage: {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      },
      costUsd: response.costUsd,
      latencyMs,
    };
  }
}
