export interface EvalCase {
  id: string;
  category: string;
  userMessage: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  expected: {
    toolCalls?: Array<{ name: string }>;
    shouldEscalate?: boolean;
    shouldCreateOrder?: boolean;
    responseContain?: string[];
    responseNotContain?: string[];
  };
}

export interface EvalResult {
  caseId: string;
  category: string;
  passed: boolean;
  toolsCalled: string[];
  responseText: string;
  costUsd: number;
  latencyMs: number;
  errors: string[];
}

export interface EvalReport {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  byCategory: Record<string, { passed: number; total: number; accuracy: number; errors: string[] }>;
  results: EvalResult[];
  totalCostUsd: number;
  avgLatencyMs: number;
}
