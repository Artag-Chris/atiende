import { z } from 'zod';

/**
 * Feature flags del sistema.
 *
 * Dos niveles:
 *  - Global (este schema): se cargan desde env vars al arranque.
 *  - Por business (en businesses.feature_overrides_jsonb): override por tenant.
 *
 * Ver docs/01_ARCHITECTURE.md §11.4 para el detalle.
 */

const boolFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const FeaturesSchema = z.object({
  llm: z.object({
    primary: z.enum(['claude', 'openai', 'mock']).default('claude'),
    fallback: z
      .enum(['claude', 'openai', 'mock'])
      .nullable()
      .default(null),
  }),
  channels: z.object({
    whatsapp: boolFromEnv.default(true),
    webChat: boolFromEnv.default(false),
    telegram: boolFromEnv.default(false),
  }),
  tools: z.object({
    catalog: boolFromEnv.default(true),
    orders: boolFromEnv.default(true),
    info: boolFromEnv.default(true),
    escalation: boolFromEnv.default(true),
  }),
  embeddings: z.object({
    provider: z.enum(['openai', 'voyage']).default('openai'),
  }),
  ai: z.object({
    promptCaching: boolFromEnv.default(true),
    compaction: boolFromEnv.default(true),
    adaptiveThinking: boolFromEnv.default(true),
  }),
  cache: z.object({
    exact: boolFromEnv.default(true),
    semantic: boolFromEnv.default(true),
    minSimilarity: z.coerce.number().min(0).max(1).default(0.95),
    ttlSeconds: z.coerce.number().int().positive().default(1800),
  }),
  observability: z.object({
    otel: boolFromEnv.default(false),
  }),
});

export type Features = z.infer<typeof FeaturesSchema>;

/**
 * Carga features desde env vars y devuelve un objeto Features validado.
 * Las flags se nombran en env como FEATURE_<SECTION>_<NAME> en SCREAMING_SNAKE_CASE.
 */
export function loadFeatures(env: NodeJS.ProcessEnv = process.env): Features {
  const raw = {
    llm: {
      primary: env.FEATURE_LLM_PRIMARY,
      fallback: env.FEATURE_LLM_FALLBACK || null,
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
      minSimilarity: env.SEMANTIC_CACHE_MIN_SIMILARITY,
      ttlSeconds: env.SEMANTIC_CACHE_TTL_SECONDS,
    },
    observability: {
      otel: env.FEATURE_OTEL,
    },
  };
  return FeaturesSchema.parse(raw);
}
