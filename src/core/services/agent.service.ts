import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LLMProviderPort, ChatResponse } from '@core/ports/llm-provider.port';
import type { AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { ToolModulePort } from '@core/ports/tool-module.port';
import type { AIConfig } from '@config/ai.config';
import type { ChatMessage, ContentBlock, Channel } from '@core/domain/types';
import {
  LLM_PROVIDER_TOKEN,
  AI_CONFIG_TOKEN,
  AGENT_RUN_REPOSITORY_TOKEN,
  TOOL_MODULES_TOKEN,
} from '@core/tokens';

export interface AgentInput {
  systemPrompt: string;
  userMessage: string;
  conversationHistory?: ChatMessage[];
  persistence?: {
    businessId: string;
    conversationId: string;
  };
  turnContext?: {
    customerPhone?: string;
    channel?: Channel;
  };
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
  toolCallsMade: Array<{ name: string; input: Record<string, unknown>; output: string }>;
}

const TOOL_TIMEOUT_MS = 10_000;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LLMProviderPort,
    @Inject(AI_CONFIG_TOKEN) private readonly config: AIConfig,
    @Inject(AGENT_RUN_REPOSITORY_TOKEN) private readonly agentRunRepo: AgentRunRepositoryPort,
    @Inject(TOOL_MODULES_TOKEN) private readonly tools: ToolModulePort[],
  ) {}

  async runTurn(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const maxIterations = this.config.agent.maxToolIterations;
    const toolMap = new Map(this.tools.map((t) => [t.name, t]));
    const toolDefinitions = this.tools.map((t) => t.getDefinition());

    if (input.persistence?.conversationId && this.config.agent.budgetUsdPerConversation > 0) {
      const currentCost = await this.agentRunRepo.getConversationCost(
        input.persistence.conversationId,
      );
      if (currentCost >= this.config.agent.budgetUsdPerConversation) {
        this.logger.warn(
          `[Agent] Budget exceeded for conversation ${input.persistence.conversationId}: $${currentCost.toFixed(6)} >= $${this.config.agent.budgetUsdPerConversation}`,
        );
        return {
          text: 'Lo siento, has alcanzado el límite de consultas para esta conversación. Por favor, contacta al equipo directamente.',
          model: this.config.primary.model,
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
          latencyMs: Date.now() - startTime,
          toolCallsMade: [],
        };
      }
    }

    const messages: ChatMessage[] = [
      ...(input.conversationHistory ?? []),
      {
        role: 'user',
        content: [{ type: 'text', text: input.userMessage }],
      },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastText = '';
    let lastCostUsd = 0;
    const toolCallsMade: Array<{ name: string; input: Record<string, unknown>; output: string }> =
      [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.chatWithAbort({
        systemPrompt: input.systemPrompt,
        messages,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        maxTokens: this.config.primary.maxTokens,
      });

      totalInputTokens += response.usage.inputTokens;
      totalOutputTokens += response.usage.outputTokens;
      lastText = response.text;
      lastCostUsd += response.costUsd;

      if (response.toolCalls.length === 0) {
        break;
      }

      const assistantContent: ContentBlock[] = [];
      if (response.text) {
        assistantContent.push({ type: 'text', text: response.text });
      }
      for (const tc of response.toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({
        role: 'assistant',
        content: assistantContent,
        ...(response.reasoningContent ? { reasoning: response.reasoningContent } : {}),
      });

      for (const tc of response.toolCalls) {
        const tool = toolMap.get(tc.name);
        if (!tool) {
          const errorResult = `Tool "${tc.name}" not found.`;
          this.logger.warn(errorResult);
          messages.push({
            role: 'tool',
            content: [
              { type: 'tool_result', toolUseId: tc.id, content: errorResult, isError: true },
            ],
          });
          toolCallsMade.push({ name: tc.name, input: tc.input, output: errorResult });
          continue;
        }

        this.logger.log(
          `[Agent] Calling tool "${tc.name}" with input: ${JSON.stringify(tc.input).slice(0, 200)}`,
        );
        const result = await this.executeToolWithTimeout(tool, tc, {
          businessId: input.persistence?.businessId ?? '',
          conversationId: input.persistence?.conversationId ?? '',
          customerPhone: input.turnContext?.customerPhone ?? '',
          channel: input.turnContext?.channel ?? 'whatsapp',
          historyLength: messages.length,
          hasPersonalInfo: false,
          mayInvolveStatefulTool: tool.mutatesState,
          businessConfig: {},
        });

        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: tc.id,
              content: result.output,
              isError: result.isError,
            },
          ],
        });
        toolCallsMade.push({ name: tc.name, input: tc.input, output: result.output });
        this.logger.log(
          JSON.stringify({
            event: 'tool_call',
            toolName: tc.name,
            isError: result.isError,
            outputLength: result.output.length,
            businessId: input.persistence?.businessId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    if (toolCallsMade.length > 0 && !lastText) {
      const finalResponse = await this.chatWithAbort({
        systemPrompt: input.systemPrompt,
        messages,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        maxTokens: this.config.primary.maxTokens,
      });
      totalInputTokens += finalResponse.usage.inputTokens;
      totalOutputTokens += finalResponse.usage.outputTokens;
      lastText = finalResponse.text;
      lastCostUsd += finalResponse.costUsd;
    }

    const latencyMs = Date.now() - startTime;

    this.logger.log(
      JSON.stringify({
        event: 'agent_turn',
        model: this.config.primary.model,
        provider: this.config.primary.provider,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: lastCostUsd,
        latencyMs,
        toolCallsCount: toolCallsMade.length,
        stopReason: toolCallsMade.length > 0 ? 'tool_use' : 'end_turn',
        businessId: input.persistence?.businessId,
        conversationId: input.persistence?.conversationId,
        channel: input.turnContext?.channel,
        timestamp: new Date().toISOString(),
      }),
    );

    if (input.persistence) {
      try {
        await this.agentRunRepo.save({
          businessId: input.persistence.businessId,
          conversationId: input.persistence.conversationId,
          model: this.config.primary.model,
          llmProvider: this.config.primary.provider,
          latencyMs,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd: lastCostUsd,
          toolCalls: toolCallsMade.map((tc) => ({ name: tc.name, input: tc.input })),
          stopReason: toolCallsMade.length > 0 ? 'tool_use' : 'end_turn',
        });
      } catch (error) {
        this.logger.error(`Failed to save agent run: ${error}`);
      }
    }

    return {
      text: lastText,
      model: this.config.primary.model,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      costUsd: lastCostUsd,
      latencyMs,
      toolCallsMade,
    };
  }

  private async chatWithAbort(req: Parameters<LLMProviderPort['chat']>[0]): Promise<ChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.primary.timeoutMs);
    try {
      return await this.llm.chat({
        ...req,
        effort: this.config.primary.effort,
        cacheable: true,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeToolWithTimeout(
    tool: ToolModulePort,
    tc: { id: string; name: string; input: Record<string, unknown> },
    ctx: Parameters<ToolModulePort['execute']>[1],
  ): Promise<{ output: string; isError?: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

    try {
      const result = await tool.execute(tc.input, ctx);
      return { output: result.output, isError: result.isError };
    } catch (error) {
      if (controller.signal.aborted) {
        this.logger.warn(`Tool "${tc.name}" timed out after ${TOOL_TIMEOUT_MS}ms`);
        return { output: `Tool "${tc.name}" timed out.`, isError: true };
      }
      this.logger.error(
        `Tool "${tc.name}" failed: ${error instanceof Error ? error.message : error}`,
      );
      return {
        output: `The tool "${tc.name}" encountered an internal error. Please try again or rephrase your request.`,
        isError: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
