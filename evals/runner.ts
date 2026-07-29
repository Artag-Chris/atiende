import 'reflect-metadata';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import type { EvalCase, EvalResult, EvalReport } from './types';
import type { LLMProviderPort, ChatResponse } from '../src/core/ports/llm-provider.port';
import type { AgentRunRepositoryPort } from '../src/core/ports/agent-run-repository.port';
import type { ToolModulePort } from '../src/core/ports/tool-module.port';
import type { AIConfig } from '../src/config/ai.config';
import { AgentService } from '../src/core/services/agent.service';

const CASES_DIR = join(__dirname, 'cases');
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function createMockLLM(): LLMProviderPort {
  return {
    name: 'mock',
    chat: async (): Promise<ChatResponse> => ({
      text: 'Hola, ¿en qué puedo ayudarte?',
      usage: { inputTokens: 50, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      costUsd: 0.0001,
      toolCalls: [],
      stopReason: 'end_turn',
    }),
    isHealthy: async () => true,
  };
}

function createMockAgentRunRepo(): AgentRunRepositoryPort {
  return {
    save: async () => {},
    getConversationCost: async () => 0,
  };
}

function createMockTool(name: string): ToolModulePort {
  return {
    name,
    mutatesState: name === 'create_order' || name === 'escalate_to_human',
    getDefinition: () => ({
      name,
      description: `Mock tool: ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: async () => ({ output: `Mock result from ${name}` }),
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

function loadCases(): EvalCase[] {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  const cases: EvalCase[] = [];

  for (const file of files) {
    const content = readFileSync(join(CASES_DIR, file), 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        cases.push(JSON.parse(line));
      } catch {
        console.error(`${YELLOW}⚠ Skipping invalid JSON in ${file}: ${line.slice(0, 60)}${RESET}`);
      }
    }
  }

  return cases;
}

function evaluateCase(
  caseData: EvalCase,
  toolNames: string[],
  responseText: string,
  latencyMs: number,
  costUsd: number,
): EvalResult {
  const errors: string[] = [];
  const toolCallsSet = new Set(toolNames);

  if (caseData.expected.toolCalls) {
    for (const expectedTool of caseData.expected.toolCalls) {
      if (!toolCallsSet.has(expectedTool.name)) {
        errors.push(`Expected tool call "${expectedTool.name}" not found. Called: [${toolNames.join(', ')}]`);
      }
    }
  }

  if (caseData.expected.shouldEscalate && !toolCallsSet.has('escalate_to_human')) {
    errors.push('Expected escalation (escalate_to_human) but tool was not called');
  }

  if (caseData.expected.shouldCreateOrder && !toolCallsSet.has('create_order')) {
    errors.push('Expected order creation (create_order) but tool was not called');
  }

  if (caseData.expected.responseContain) {
    const lowerResponse = responseText.toLowerCase();
    for (const substr of caseData.expected.responseContain) {
      if (!lowerResponse.includes(substr.toLowerCase())) {
        errors.push(`Response should contain "${substr}"`);
      }
    }
  }

  if (caseData.expected.responseNotContain) {
    const lowerResponse = responseText.toLowerCase();
    for (const substr of caseData.expected.responseNotContain) {
      if (lowerResponse.includes(substr.toLowerCase())) {
        errors.push(`Response should NOT contain "${substr}"`);
      }
    }
  }

  return {
    caseId: caseData.id,
    category: caseData.category,
    passed: errors.length === 0,
    toolsCalled: toolNames,
    responseText: responseText.slice(0, 200),
    costUsd,
    latencyMs,
    errors,
  };
}

function printReport(report: EvalReport): void {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}  ATIENDE EVAL SUITE — REPORT${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════${RESET}\n`);

  const pct = (report.accuracy * 100).toFixed(1);
  const color = report.accuracy >= 0.85 ? GREEN : report.accuracy >= 0.7 ? YELLOW : RED;
  console.log(`  Accuracy:     ${color}${pct}% (${report.passed}/${report.total})${RESET}`);
  console.log(`  Total cost:   $${report.totalCostUsd.toFixed(6)}`);
  console.log(`  Avg latency:  ${report.avgLatencyMs.toFixed(0)}ms\n`);

  console.log(`${BOLD}Breakdown by category:${RESET}`);
  for (const [cat, data] of Object.entries(report.byCategory)) {
    const catColor = data.accuracy >= 0.85 ? GREEN : data.accuracy >= 0.7 ? YELLOW : RED;
    const catPct = (data.accuracy * 100).toFixed(1);
    const errors = data.errors.length > 0 ? ` ${RED}✗${RESET}` : ` ${GREEN}✓${RESET}`;
    console.log(`  ${catColor}${cat.padEnd(20)}${RESET} ${catPct}% (${data.passed}/${data.total})${errors}`);
  }

  const failed = report.results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log(`\n${BOLD}${RED}Failed cases:${RESET}`);
    for (const f of failed) {
      console.log(`  ${RED}✗ ${f.caseId}${RESET}`);
      for (const err of f.errors) {
        console.log(`    - ${err}`);
      }
    }
  }

  const passThreshold = report.accuracy >= 0.85;
  console.log(`\n${BOLD}${'─'.repeat(45)}${RESET}`);
  console.log(`${BOLD}Result: ${passThreshold ? `${GREEN}PASS (≥ 85%)${RESET}` : `${RED}FAIL (< 85%)${RESET}`}${RESET}\n`);
}

async function loadRealLLM(): Promise<LLMProviderPort | null> {
  const provider = process.env.EVAL_LLM_PROVIDER ?? 'groq';
  const apiKey = process.env.EVAL_API_KEY ?? process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.log(`${YELLOW}⚠ No EVAL_API_KEY / GROQ_API_KEY / OPENAI_API_KEY set. Using mock LLM.${RESET}`);
    console.log(`  Set EVAL_REAL=true + EVAL_API_KEY=sk-... to use real LLM.\n`);
    return null;
  }

  try {
    if (provider === 'groq') {
      const { GroqAdapter } = await import('../src/modules/llm/groq/groq.adapter');
      const { ConfigService } = await import('@nestjs/config');
      const config = new ConfigService({ GROQ_API_KEY: apiKey });
      return new GroqAdapter(config, defaultConfig);
    }
    if (provider === 'openai') {
      const { OpenAIEmbeddingsAdapter } = await import('../src/modules/embeddings/openai/openai-embeddings.adapter');
      return null;
    }
    const { GroqAdapter } = await import('../src/modules/llm/groq/groq.adapter');
    const { ConfigService } = await import('@nestjs/config');
    const config = new ConfigService({ GROQ_API_KEY: apiKey });
    return new GroqAdapter(config, defaultConfig);
  } catch {
    console.log(`${YELLOW}⚠ Failed to load real LLM provider "${provider}". Falling back to mock.${RESET}`);
    return null;
  }
}

async function main(): Promise<void> {
  const cases = loadCases();
  console.log(`${BOLD}Loaded ${cases.length} eval cases${RESET}\n`);

  let llm: LLMProviderPort;
  const useReal = process.env.EVAL_REAL === 'true';
  const providerName: string = useReal ? (process.env.EVAL_LLM_PROVIDER ?? 'groq') : 'mock';
  const toolNames = ['get_business_info', 'escalate_to_human', 'search_catalog', 'get_product', 'create_order', 'search_knowledge'];

  if (useReal) {
    const realLLM = await loadRealLLM();
    if (!realLLM) {
      console.log(`${YELLOW}⚠ Falling back to mock LLM.${RESET}`);
      llm = createMockLLM();
    } else {
      llm = realLLM;
    }
  } else {
    llm = createMockLLM();
  }

  const mockRepo = createMockAgentRunRepo();

  const tools: ToolModulePort[] = toolNames.map(createMockTool);
  const agent = new AgentService(llm, defaultConfig, mockRepo, tools);

  const results: EvalResult[] = [];

  for (const caseData of cases) {
    const start = Date.now();
    let responseText = '';
    let costUsd = 0;
    let toolNamesCalled: string[] = [];

    try {
      const agentOut = await agent.runTurn({
        systemPrompt: 'Eres un asistente de IA para un negocio. Responde preguntas sobre productos, precios, y ayuda a los clientes.',
        userMessage: caseData.userMessage,
        conversationHistory: caseData.conversationHistory?.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: [{ type: 'text' as const, text: m.text }],
        })),
        turnContext: { customerPhone: '573001234567', channel: 'whatsapp' },
      });

      responseText = agentOut.text;
      costUsd = agentOut.costUsd;
      toolNamesCalled = agentOut.toolCallsMade.map((t) => t.name);
    } catch (err) {
      responseText = `ERROR: ${err}`;
    }

    const latencyMs = Date.now() - start;

    const result = evaluateCase(caseData, toolNamesCalled, responseText, latencyMs, costUsd);
    results.push(result);

    const icon = result.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const toolStr = result.toolsCalled.length > 0 ? ` [${result.toolsCalled.join(', ')}]` : '';
    console.log(`  ${icon} ${caseData.id.padEnd(18)} ${caseData.userMessage.slice(0, 50).padEnd(52)}${toolStr}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const avgLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;

  const byCategory: Record<string, { passed: number; total: number; accuracy: number; errors: string[] }> = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { passed: 0, total: 0, accuracy: 0, errors: [] };
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
    else byCategory[r.category].errors.push(r.caseId);
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].accuracy = byCategory[cat].total > 0 ? byCategory[cat].passed / byCategory[cat].total : 0;
  }

  const report: EvalReport = {
    total: cases.length,
    passed,
    failed: results.length - passed,
    accuracy: results.length > 0 ? passed / results.length : 0,
    byCategory,
    results,
    totalCostUsd,
    avgLatencyMs,
  };

  printReport(report);

  if (report.accuracy < 0.85) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
