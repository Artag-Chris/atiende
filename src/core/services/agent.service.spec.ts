import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from './agent.service';
import type { LLMProviderPort } from '@core/ports/llm-provider.port';
import type { AgentRunRepositoryPort } from '@core/ports/agent-run-repository.port';
import type { ToolModulePort } from '@core/ports/tool-module.port';
import type { AIConfig } from '@config/ai.config';

function createMockLLM(): LLMProviderPort {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      text: 'Hola, ¿en qué puedo ayudarte?',
      usage: { inputTokens: 50, outputTokens: 20 },
      costUsd: 0.0001,
      toolCalls: [],
      stopReason: 'end_turn',
    }),
    isHealthy: vi.fn().mockResolvedValue(true),
  };
}

function createMockAgentRunRepo(): AgentRunRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getConversationCost: vi.fn().mockResolvedValue(0),
  };
}

function createMockTool(name = 'test_tool'): ToolModulePort {
  return {
    name,
    mutatesState: false,
    getDefinition: vi.fn().mockReturnValue({
      name,
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ output: 'tool result' }),
  };
}

const defaultConfig: AIConfig = {
  primary: { provider: 'mock', model: 'mock-1', effort: 'medium', maxTokens: 1024, timeoutMs: 5000, maxRetries: 0 },
  fallback: null,
  promptCaching: { enabled: false, defaultTtl: '5m', minTokensToCache: 2048 },
  compaction: { enabled: false, triggerTokenThreshold: 100000 },
  adaptiveThinking: false,
  agent: { maxToolIterations: 8, maxConversationTokens: 100000, budgetUsdPerConversation: 0.5, targetLatencyP95Ms: 5000 },
};

describe('AgentService', () => {
  let service: AgentService;
  let llm: ReturnType<typeof createMockLLM>;
  let agentRunRepo: ReturnType<typeof createMockAgentRunRepo>;

  beforeEach(() => {
    llm = createMockLLM();
    agentRunRepo = createMockAgentRunRepo();
    service = new AgentService(llm as unknown as LLMProviderPort, defaultConfig, agentRunRepo, []);
  });

  it('returns LLM response when no tools called', async () => {
    const result = await service.runTurn({
      systemPrompt: 'You are a test assistant.',
      userMessage: 'Hello',
    });

    expect(result.text).toBe('Hola, ¿en qué puedo ayudarte?');
    expect(result.costUsd).toBe(0.0001);
    expect(result.toolCallsMade).toHaveLength(0);
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('executes tool and makes final LLM call', async () => {
    const tool = createMockTool();
    const serviceWithTools = new AgentService(llm as unknown as LLMProviderPort, defaultConfig, agentRunRepo, [tool]);

    let callCount = 0;
    llm.chat = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: '',
          usage: { inputTokens: 100, outputTokens: 30 },
          costUsd: 0.0002,
          toolCalls: [{ id: 'tc-1', name: 'test_tool', input: {} }],
          stopReason: 'tool_use',
        });
      }
      return Promise.resolve({
        text: 'La herramienta respondió: tool result',
        usage: { inputTokens: 80, outputTokens: 25 },
        costUsd: 0.00015,
        toolCalls: [],
        stopReason: 'end_turn',
      });
    });

    const result = await serviceWithTools.runTurn({
      systemPrompt: 'Test',
      userMessage: 'Use the tool',
    });

    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(result.text).toBe('La herramienta respondió: tool result');
    expect(result.toolCallsMade).toHaveLength(1);
    expect(result.toolCallsMade[0].name).toBe('test_tool');
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it('enforces max tool iterations then makes final LLM call', async () => {
    const tool = createMockTool();
    const config = { ...defaultConfig, agent: { ...defaultConfig.agent, maxToolIterations: 2 } };
    const serviceLimited = new AgentService(llm as unknown as LLMProviderPort, config, agentRunRepo, [tool]);

    let callCount = 0;
    llm.chat = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve({
          text: '',
          usage: { inputTokens: 50, outputTokens: 20 },
          costUsd: 0.0001,
          toolCalls: [{ id: `tc-${callCount}`, name: 'test_tool', input: {} }],
          stopReason: 'tool_use',
        });
      }
      return Promise.resolve({
        text: 'Final response after tools',
        usage: { inputTokens: 50, outputTokens: 20 },
        costUsd: 0.0001,
        toolCalls: [],
        stopReason: 'end_turn',
      });
    });

    const result = await serviceLimited.runTurn({
      systemPrompt: 'Test',
      userMessage: 'Use the tool many times',
    });

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(tool.execute).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('Final response after tools');
  });

  it('passes budget exceeded message when cost limit reached', async () => {
    agentRunRepo.getConversationCost = vi.fn().mockResolvedValue(1.0);

    const result = await service.runTurn({
      systemPrompt: 'Test',
      userMessage: 'Hello',
      persistence: { businessId: 'biz-1', conversationId: 'conv-1' },
    });

    expect(result.text).toContain('límite');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('saves agent run when persistence provided', async () => {
    await service.runTurn({
      systemPrompt: 'Test',
      userMessage: 'Hello',
      persistence: { businessId: 'biz-1', conversationId: 'conv-1' },
    });

    expect(agentRunRepo.save).toHaveBeenCalledTimes(1);
    expect(agentRunRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        conversationId: 'conv-1',
      }),
    );
  });

  it('does not save agent run without persistence', async () => {
    await service.runTurn({
      systemPrompt: 'Test',
      userMessage: 'Hello',
    });

    expect(agentRunRepo.save).not.toHaveBeenCalled();
  });
});
