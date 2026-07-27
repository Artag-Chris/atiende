import { Logger } from '@nestjs/common';
import type { Env } from './env';

const logger = new Logger('AIConfig');

/**
 * Configuración centralizada de IA (LLM providers, prompt caching, agente).
 *
 * Esta es la "fuente de verdad" del comportamiento de la capa de IA.
 * Los adapters concretos (Claude, OpenAI, mock) leen de aquí, no de env
 * directamente, para que un solo lugar gobierne la estrategia.
 *
 * Ver:
 *  - docs/01_ARCHITECTURE.md §11.3 (Adapter pattern para LLMs)
 *  - docs/01_ARCHITECTURE.md §12 (Caching multinivel)
 *  - docs/01_ARCHITECTURE.md §13 (Resiliencia y failover)
 *  - docs/02_AI_CONCEPTS.md §9 (Prompt caching)
 */

// ============================================================================
// Pricing actual (USD por 1M tokens). Mayo 2026.
// Mantener sincronizado con docs/02_AI_CONCEPTS.md §10.
// Verificar trimestralmente en platform.claude.com/pricing.
// ============================================================================

export interface ModelPricing {
  /** USD por 1M tokens de input (no cacheado). */
  inputPer1M: number;
  /** USD por 1M tokens de output. */
  outputPer1M: number;
  /** USD por 1M tokens al ESCRIBIR al cache (5min TTL). */
  cacheWrite5mPer1M: number;
  /** USD por 1M tokens al ESCRIBIR al cache (1h TTL). */
  cacheWrite1hPer1M: number;
  /** USD por 1M tokens al LEER del cache. */
  cacheReadPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4-7': {
    inputPer1M: 5.0,
    outputPer1M: 25.0,
    cacheWrite5mPer1M: 6.25,
    cacheWrite1hPer1M: 10.0,
    cacheReadPer1M: 0.5,
  },
  'claude-sonnet-4-6': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheWrite5mPer1M: 3.75,
    cacheWrite1hPer1M: 6.0,
    cacheReadPer1M: 0.3,
  },
  'claude-haiku-4-5': {
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    cacheWrite5mPer1M: 1.25,
    cacheWrite1hPer1M: 2.0,
    cacheReadPer1M: 0.1,
  },
  // OpenAI (fallback)
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    // OpenAI cachea automáticamente prompts > 1024 tokens, sin charge extra
    // por write — sólo descuento en read.
    cacheWrite5mPer1M: 0.15,
    cacheWrite1hPer1M: 0.15,
    cacheReadPer1M: 0.075,
  },
  // Google Gemini (free tier)
  'gemini-2.0-flash': {
    inputPer1M: 0,
    outputPer1M: 0,
    cacheWrite5mPer1M: 0,
    cacheWrite1hPer1M: 0,
    cacheReadPer1M: 0,
  },
  'gemini-2.5-flash': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cacheWrite5mPer1M: 0.15,
    cacheWrite1hPer1M: 0.15,
    cacheReadPer1M: 0.0375,
  },
  // Groq (free tier — OpenAI-compatible)
  'llama-3.3-70b-versatile': {
    inputPer1M: 0,
    outputPer1M: 0,
    cacheWrite5mPer1M: 0,
    cacheWrite1hPer1M: 0,
    cacheReadPer1M: 0,
  },
  'llama-3.1-8b-instant': {
    inputPer1M: 0,
    outputPer1M: 0,
    cacheWrite5mPer1M: 0,
    cacheWrite1hPer1M: 0,
    cacheReadPer1M: 0,
  },
};

// ============================================================================
// Tipos de configuración
// ============================================================================

export type LLMProviderName = 'claude' | 'openai' | 'gemini' | 'groq' | 'mock';

export interface LLMProviderConfig {
  provider: LLMProviderName;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface PromptCachingConfig {
  enabled: boolean;
  /** TTL preferido del cache de Anthropic. 5m default; 1h para hot businesses. */
  defaultTtl: '5m' | '1h';
  /**
   * Mínimo de tokens en el prefijo para considerar cachear. Por debajo,
   * Anthropic ignora el cache_control silenciosamente. Ver shared/prompt-caching.md
   * — varía por modelo (Opus 4.7 / Haiku 4.5: 4096; Sonnet 4.6: 2048).
   */
  minTokensToCache: number;
}

export interface CompactionConfig {
  enabled: boolean;
  /**
   * Umbral aproximado de tokens en el historial para activar compaction
   * preventivamente. La API tiene su propio trigger interno; este es para
   * nuestro logging y métricas.
   */
  triggerTokenThreshold: number;
}

export interface AgentLimits {
  /** Max iteraciones del loop tool_use → tool_result. Previene loops infinitos. */
  maxToolIterations: number;
  /** Max tokens de historial antes de forzar compaction agresiva. */
  maxConversationTokens: number;
  /** Budget de USD por conversación. 0 = sin límite (no recomendado en prod). */
  budgetUsdPerConversation: number;
  /** Latencia objetivo p95 (ms). Para alertas, no enforce. */
  targetLatencyP95Ms: number;
}

export interface AIConfig {
  primary: LLMProviderConfig;
  fallback: LLMProviderConfig | null;
  promptCaching: PromptCachingConfig;
  compaction: CompactionConfig;
  adaptiveThinking: boolean;
  agent: AgentLimits;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Construye AIConfig validado a partir de env. Llamar UNA VEZ al boot y
 * proveer vía DI con el token FEATURES o AI_CONFIG.
 */
export function buildAIConfig(env: Env): AIConfig {
  const isPrimaryOpenAI = env.FEATURE_LLM_PRIMARY === 'openai';
  const isPrimaryGemini = env.FEATURE_LLM_PRIMARY === 'gemini';
  const isPrimaryGroq = env.FEATURE_LLM_PRIMARY === 'groq';

  return {
    primary: {
      provider: env.FEATURE_LLM_PRIMARY,
      model: modelForProvider(env.FEATURE_LLM_PRIMARY, env),
      effort: isPrimaryOpenAI || isPrimaryGemini || isPrimaryGroq ? 'medium' : env.ANTHROPIC_EFFORT,
      maxTokens: env.ANTHROPIC_MAX_TOKENS,
      timeoutMs: isPrimaryOpenAI
        ? env.OPENAI_TIMEOUT_MS
        : isPrimaryGemini
          ? env.GEMINI_TIMEOUT_MS
          : isPrimaryGroq
            ? env.GROQ_TIMEOUT_MS
            : env.ANTHROPIC_TIMEOUT_MS,
      maxRetries: isPrimaryOpenAI
        ? env.OPENAI_MAX_RETRIES
        : isPrimaryGemini
          ? env.GEMINI_MAX_RETRIES
          : isPrimaryGroq
            ? env.GROQ_MAX_RETRIES
            : env.ANTHROPIC_MAX_RETRIES,
    },
    fallback: buildFallbackConfig(env),
    promptCaching: {
      enabled: env.ANTHROPIC_PROMPT_CACHING && env.FEATURE_AI_PROMPT_CACHING,
      defaultTtl: env.ANTHROPIC_CACHE_TTL,
      minTokensToCache: minCacheTokensForModel(env.ANTHROPIC_MODEL),
    },
    compaction: {
      enabled: env.ANTHROPIC_COMPACTION && env.FEATURE_AI_COMPACTION,
      triggerTokenThreshold: env.AGENT_MAX_CONVERSATION_TOKENS,
    },
    adaptiveThinking: env.ANTHROPIC_ADAPTIVE_THINKING && env.FEATURE_AI_ADAPTIVE_THINKING,
    agent: {
      maxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
      maxConversationTokens: env.AGENT_MAX_CONVERSATION_TOKENS,
      budgetUsdPerConversation: env.AGENT_BUDGET_USD_PER_CONVERSATION,
      targetLatencyP95Ms: env.AGENT_TARGET_LATENCY_P95_MS,
    },
  };
}

function buildFallbackConfig(env: Env): LLMProviderConfig | null {
  const fallback = env.FEATURE_LLM_FALLBACK;
  if (fallback === '' || fallback === undefined) return null;
  return {
    provider: fallback,
    model: modelForProvider(fallback, env),
    effort: 'medium',
    maxTokens: env.ANTHROPIC_MAX_TOKENS,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxRetries: env.OPENAI_MAX_RETRIES,
  };
}

function modelForProvider(provider: LLMProviderName, env: Env): string {
  switch (provider) {
    case 'claude':
      return env.ANTHROPIC_MODEL;
    case 'openai':
      return env.OPENAI_FALLBACK_CHAT_MODEL;
    case 'gemini':
      return env.GEMINI_MODEL;
    case 'groq':
      return env.GROQ_MODEL;
    case 'mock':
      return 'mock';
  }
}

/**
 * Mínimo de tokens cacheables. Anthropic ignora silenciosamente cache_control
 * en prefijos más cortos. Ver shared/prompt-caching.md.
 */
function minCacheTokensForModel(model: string): number {
  if (model.startsWith('claude-opus-4-7') || model.startsWith('claude-haiku-4-5')) {
    return 4096;
  }
  if (model.startsWith('claude-sonnet-4-6')) {
    return 2048;
  }
  // Default conservador.
  return 4096;
}

// ============================================================================
// Helpers de costo
// ============================================================================

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
}

const warnedUnknownModels = new Set<string>();

export function calculateCost(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  },
  cacheTtl: '5m' | '1h' = '5m',
): CostBreakdown {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    // Modelo desconocido — devolvemos costos en 0 PERO logueamos warning una
    // sola vez por modelo (evita spam). El operador debe agregar el pricing
    // a MODEL_PRICING. Sin esto, métricas de costo silenciosamente serían 0.
    if (!warnedUnknownModels.has(model)) {
      warnedUnknownModels.add(model);
      logger.warn(
        `Unknown model "${model}" — cost tracking will report 0 until added to MODEL_PRICING. ` +
          `Tokens: in=${usage.inputTokens} out=${usage.outputTokens}`,
      );
    }
    return { inputUsd: 0, outputUsd: 0, cacheWriteUsd: 0, cacheReadUsd: 0, totalUsd: 0 };
  }

  const cacheWriteRate = cacheTtl === '1h' ? pricing.cacheWrite1hPer1M : pricing.cacheWrite5mPer1M;

  const inputUsd = (usage.inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputUsd = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  const cacheWriteUsd = (usage.cacheCreationInputTokens / 1_000_000) * cacheWriteRate;
  const cacheReadUsd = (usage.cacheReadInputTokens / 1_000_000) * pricing.cacheReadPer1M;

  const totalUsd = inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd;
  return { inputUsd, outputUsd, cacheWriteUsd, cacheReadUsd, totalUsd };
}

// ============================================================================
// Circuit breaker config (para LLMRouterService — ver arch §13.3)
// ============================================================================

export interface CircuitBreakerConfig {
  failureThreshold: number;
  errorRateThreshold: number;
  windowMs: number;
  openTimeoutMs: number;
  halfOpenProbes: number;
}

export function buildCircuitBreakerConfig(env: Env): CircuitBreakerConfig {
  return {
    failureThreshold: env.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    errorRateThreshold: env.CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD,
    windowMs: env.CIRCUIT_BREAKER_WINDOW_MS,
    openTimeoutMs: env.CIRCUIT_BREAKER_OPEN_TIMEOUT_MS,
    halfOpenProbes: env.CIRCUIT_BREAKER_HALF_OPEN_PROBES,
  };
}
