import type { Env } from './env';

/**
 * Feature flags consolidados.
 *
 * NO se valida con Zod aquí porque el schema lo hace env.ts. Esta función
 * solo toma el Env validado y construye un objeto bien tipado para inyección.
 *
 * Dos niveles de flags (ver docs/01_ARCHITECTURE.md §11.4):
 *  - Global: este objeto, hidratado desde env vars al boot.
 *  - Por business: businesses.feature_overrides_jsonb, leído en runtime
 *    por FeatureService.
 */

export interface Features {
  llm: {
    primary: 'claude' | 'openai' | 'mock';
    fallback: 'claude' | 'openai' | 'mock' | null;
  };
  channels: {
    whatsapp: boolean;
    webChat: boolean;
    telegram: boolean;
  };
  tools: {
    catalog: boolean;
    orders: boolean;
    info: boolean;
    escalation: boolean;
  };
  embeddings: {
    provider: 'openai' | 'voyage';
  };
  ai: {
    promptCaching: boolean;
    compaction: boolean;
    adaptiveThinking: boolean;
  };
  cache: {
    exact: boolean;
    semantic: boolean;
    semanticMinSimilarity: number;
    semanticTtlSeconds: number;
    exactTtlSeconds: number;
  };
  observability: {
    otel: boolean;
    sentry: boolean;
  };
}

export function buildFeatures(env: Env): Features {
  return {
    llm: {
      primary: env.FEATURE_LLM_PRIMARY,
      fallback: env.FEATURE_LLM_FALLBACK === '' ? null : env.FEATURE_LLM_FALLBACK,
    },
    channels: {
      whatsapp: env.FEATURE_CHANNEL_WHATSAPP,
      webChat: env.FEATURE_CHANNEL_WEB_CHAT,
      telegram: env.FEATURE_CHANNEL_TELEGRAM,
    },
    tools: {
      catalog: env.FEATURE_TOOL_CATALOG,
      orders: env.FEATURE_TOOL_ORDERS,
      info: env.FEATURE_TOOL_INFO,
      escalation: env.FEATURE_TOOL_ESCALATION,
    },
    embeddings: {
      provider: env.FEATURE_EMBEDDINGS_PROVIDER,
    },
    ai: {
      promptCaching: env.FEATURE_AI_PROMPT_CACHING,
      compaction: env.FEATURE_AI_COMPACTION,
      adaptiveThinking: env.FEATURE_AI_ADAPTIVE_THINKING,
    },
    cache: {
      exact: env.FEATURE_CACHE_EXACT,
      semantic: env.FEATURE_CACHE_SEMANTIC,
      semanticMinSimilarity: env.SEMANTIC_CACHE_MIN_SIMILARITY,
      semanticTtlSeconds: env.SEMANTIC_CACHE_TTL_SECONDS,
      exactTtlSeconds: env.EXACT_CACHE_TTL_SECONDS,
    },
    observability: {
      otel: env.FEATURE_OTEL,
      sentry: !!env.SENTRY_DSN,
    },
  };
}
