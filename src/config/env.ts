import { z } from 'zod';

/**
 * Schema de validación de variables de entorno.
 *
 * Se valida al arrancar la app (fail-fast: si falta una env crítica, no arranca).
 * Esta es la fuente de verdad — cualquier variable nueva DEBE agregarse aquí
 * o no estará tipada y validada.
 *
 * Ver .env.example para la descripción de cada variable.
 */

const boolFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const EnvSchema = z
  .object({
    // ============================================================
    // 1. APPLICATION
    // ============================================================
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

    // ============================================================
    // 2. DATABASE
    // ============================================================
    DATABASE_URL: z.string().url(),
    DB_CONNECTION_POOL_SIZE: z.coerce.number().int().positive().default(10),
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    PRISMA_LOG_LEVEL: z.string().default('warn,error'),

    // ============================================================
    // 3. REDIS
    // ============================================================
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_TLS: boolFromEnv.default(false),
    REDIS_PREFIX: z.string().default('atiende:dev'),

    // ============================================================
    // 4. ANTHROPIC
    // ============================================================
    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
    ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
    ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    ANTHROPIC_PROMPT_CACHING: boolFromEnv.default(true),
    ANTHROPIC_CACHE_TTL: z.enum(['5m', '1h']).default('5m'),
    ANTHROPIC_ADAPTIVE_THINKING: boolFromEnv.default(true),
    ANTHROPIC_COMPACTION: boolFromEnv.default(true),

    // ============================================================
    // 5. OPENAI
    // ============================================================
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    OPENAI_FALLBACK_CHAT_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    // ============================================================
    // 5b. GEMINI (Google AI Studio — free tier)
    // ============================================================
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    // ============================================================
    // 5c. GROQ (Groq Cloud — free tier, OpenAI-compatible)
    // ============================================================
    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
    GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    GROQ_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    // ============================================================
    // 5d. KIMI (Moonshot AI — OpenAI-compatible, modelo de razonamiento)
    // ============================================================
    KIMI_API_KEY: z.string().optional(),
    KIMI_MODEL: z.string().default('kimi-k3'),
    KIMI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    KIMI_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    KIMI_MAX_RETRIES: z.coerce.number().int().min(0).default(3),

    // ============================================================
    // 6. META WHATSAPP
    // ============================================================
    META_APP_ID: z.string().min(1, 'META_APP_ID is required'),
    META_APP_SECRET: z
      .string()
      .min(1, 'META_APP_SECRET is required for webhook signature verification'),
    META_WEBHOOK_VERIFY_TOKEN: z
      .string()
      .min(8, 'META_WEBHOOK_VERIFY_TOKEN must be at least 8 chars'),
    META_GRAPH_API_VERSION: z.string().default('v21.0'),
    META_GRAPH_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
    META_DEV_PHONE_NUMBER_ID: z.string().optional(),
    META_DEV_ACCESS_TOKEN: z.string().optional(),

    // ============================================================
    // 6b. META INSTAGRAM + MESSENGER (Messenger Platform, mismo host)
    // ============================================================
    FEATURE_CHANNEL_INSTAGRAM: boolFromEnv.default(false),
    FEATURE_CHANNEL_MESSENGER: boolFromEnv.default(false),
    /**
     * App Secret de la app de Meta donde está configurado Instagram.
     * Solo necesario si Instagram usa UNA APP DISTINTA a la de WhatsApp
     * (cada app tiene su propio secret). Si comparte la app, se usa
     * META_APP_SECRET.
     */
    META_INSTAGRAM_APP_SECRET: z.string().optional(),
    /**
     * Versión de la Graph API de Instagram (graph.instagram.com). Independiente
     * de META_GRAPH_API_VERSION (host distinto y ciclo de deprecación propio).
     */
    META_INSTAGRAM_GRAPH_API_VERSION: z.string().default('v25.0'),
    META_DEV_IG_ID: z.string().optional(),
    META_DEV_IG_TOKEN: z.string().optional(),
    META_DEV_PAGE_ID: z.string().optional(),
    META_DEV_PAGE_TOKEN: z.string().optional(),

    // ============================================================
    // 7. ENCRYPTION
    // ============================================================
    ENCRYPTION_MASTER_KEY: z
      .string()
      .min(1, 'ENCRYPTION_MASTER_KEY is required (32 bytes base64)')
      .refine((v) => {
        try {
          return Buffer.from(v, 'base64').length === 32;
        } catch {
          return false;
        }
      }, 'ENCRYPTION_MASTER_KEY must be 32 bytes encoded as base64'),

    // ============================================================
    // 8. WEBHOOK BEHAVIOR
    // ============================================================
    WEBHOOK_GROUPING_WINDOW_MS: z.coerce.number().int().min(0).default(8000),
    WEBHOOK_BODY_SIZE_LIMIT_KB: z.coerce.number().int().positive().default(128),
    WEBHOOK_RATE_LIMIT_PER_BUSINESS_PER_MIN: z.coerce.number().int().positive().default(600),

    // ============================================================
    // 9. AGENT BUDGETS
    // ============================================================
    AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(8),
    AGENT_MAX_CONVERSATION_TOKENS: z.coerce.number().int().positive().default(50000),
    AGENT_BUDGET_USD_PER_CONVERSATION: z.coerce.number().min(0).default(0.5),
    AGENT_TARGET_LATENCY_P95_MS: z.coerce.number().int().positive().default(5000),

    // ============================================================
    // 10. RAG
    // ============================================================
    RAG_TOP_K: z.coerce.number().int().positive().default(5),
    RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.6),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().default(100),

    // Chunking (para ingesta de PDFs, FAQs, manuales — ver knowledge_documents).
    CHUNK_MAX_TOKENS: z.coerce.number().int().positive().default(500),
    CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(50),
    /** Tamaño máximo de archivo subido para ingesta de conocimiento (MB). */
    KNOWLEDGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(20),

    // ============================================================
    // 11. RESPONSE CACHING
    // ============================================================
    FEATURE_CACHE_EXACT: boolFromEnv.default(true),
    EXACT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    FEATURE_CACHE_SEMANTIC: boolFromEnv.default(true),
    SEMANTIC_CACHE_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.95),
    SEMANTIC_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    SEMANTIC_CACHE_CLEANUP_INTERVAL_S: z.coerce.number().int().positive().default(300),

    // ============================================================
    // 12. CIRCUIT BREAKER
    // ============================================================
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    CIRCUIT_BREAKER_ERROR_RATE_THRESHOLD: z.coerce.number().min(0).max(100).default(50),
    CIRCUIT_BREAKER_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    CIRCUIT_BREAKER_OPEN_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    CIRCUIT_BREAKER_HALF_OPEN_PROBES: z.coerce.number().int().positive().default(1),

    // ============================================================
    // 13. BULLMQ
    // ============================================================
    BULLMQ_QUEUE_PREFIX: z.string().default('atiende:dev:queue'),
    BULLMQ_INBOUND_CONCURRENCY: z.coerce.number().int().positive().default(10),
    BULLMQ_AGENT_CONCURRENCY: z.coerce.number().int().positive().default(4),
    BULLMQ_OUTBOUND_CONCURRENCY: z.coerce.number().int().positive().default(20),
    BULLMQ_INDEXING_CONCURRENCY: z.coerce.number().int().positive().default(2),
    BULLMQ_KNOWLEDGE_INDEXING_CONCURRENCY: z.coerce.number().int().positive().default(2),
    BULLMQ_DEFAULT_ATTEMPTS: z.coerce.number().int().positive().default(3),
    BULLMQ_BACKOFF_INITIAL_MS: z.coerce.number().int().positive().default(1000),
    BULLMQ_KEEP_COMPLETED: z.coerce.number().int().min(0).default(1000),
    BULLMQ_KEEP_FAILED: z.coerce.number().int().min(0).default(5000),
    BULLMQ_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(30000),

    // ============================================================
    // 14-17. FEATURE FLAGS (consumidos por src/config/features.ts)
    // ============================================================
    FEATURE_LLM_PRIMARY: z
      .enum(['claude', 'openai', 'gemini', 'groq', 'kimi', 'mock'])
      .default('claude'),
    FEATURE_LLM_FALLBACK: z
      .union([z.enum(['claude', 'openai', 'gemini', 'groq', 'kimi', 'mock']), z.literal('')])
      .default(''),
    FEATURE_AI_PROMPT_CACHING: boolFromEnv.default(true),
    FEATURE_AI_COMPACTION: boolFromEnv.default(true),
    FEATURE_AI_ADAPTIVE_THINKING: boolFromEnv.default(true),
    FEATURE_AI_SCOPE_GUARD: boolFromEnv.default(true),
    FEATURE_CHANNEL_WHATSAPP: boolFromEnv.default(true),
    FEATURE_CHANNEL_WEB_CHAT: boolFromEnv.default(false),
    FEATURE_CHANNEL_TELEGRAM: boolFromEnv.default(false),
    FEATURE_TOOL_CATALOG: boolFromEnv.default(true),
    FEATURE_TOOL_KNOWLEDGE_SEARCH: boolFromEnv.default(true),
    FEATURE_TOOL_ORDERS: boolFromEnv.default(true),
    FEATURE_TOOL_INFO: boolFromEnv.default(true),
    FEATURE_TOOL_ESCALATION: boolFromEnv.default(true),
    FEATURE_EMBEDDINGS_PROVIDER: z.enum(['openai', 'voyage']).default('openai'),

    // ============================================================
    // 18. OBSERVABILIDAD
    // ============================================================
    FEATURE_OTEL: boolFromEnv.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OTEL_SERVICE_NAME: z.string().default('atiende'),
    SENTRY_DSN: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    // ============================================================
    // 19. DASHBOARD / FRONTEND
    // ============================================================
    DASHBOARD_URL: z.string().url().default('http://localhost:3001'),
    CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3001'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
    JWT_EXPIRES_IN: z.string().default('1h'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    // ============================================================
    // 19b. HUMAN TAKEOVER / MANTENIMIENTO
    // ============================================================
    /** Horas de inactividad (lastMessageAt) antes de auto-desescalar a ACTIVE. */
    ESCALATION_EXPIRY_HOURS: z.coerce.number().int().positive().default(72),
    /** Cada cuántas horas corre el barrido de expiración de escalaciones. */
    ESCALATION_EXPIRY_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),

    // ============================================================
    // 20. SEEDING (dev only)
    // ============================================================
    SEED_ADMIN_EMAIL: z.string().email().default('admin@atiende.dev'),
    SEED_ADMIN_PASSWORD: z.string().min(6).default('admin123'),
    SEED_CHRISTIAN_EMAIL: z.string().email().default('christian@atiende.dev'),
    SEED_CHRISTIAN_PASSWORD: z.string().min(6).default('vakaloka88!'),

    // ============================================================
    // 21. NOTIFICATIONS
    // ============================================================
    NOTIFICATIONS_PROVIDER: z.enum(['resend', 'postmark', 'smtp', 'none']).default('none'),
    RESEND_API_KEY: z.string().optional(),
    NOTIFICATIONS_FROM_EMAIL: z.string().email().optional(),
  })
  .superRefine((env, ctx) => {
    // La key de un provider optional solo es obligatoria si ese provider se usa.
    // Sin esto, el OpenAI SDK resuelve apiKey:undefined a OPENAI_API_KEY (default
    // de su constructor) y mandaría la key de OpenAI a un tercero (p.ej. Moonshot).
    const usesKimi = env.FEATURE_LLM_PRIMARY === 'kimi' || env.FEATURE_LLM_FALLBACK === 'kimi';
    if (usesKimi && !env.KIMI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['KIMI_API_KEY'],
        message:
          'KIMI_API_KEY is required when FEATURE_LLM_PRIMARY or FEATURE_LLM_FALLBACK is "kimi"',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/**
 * Carga y valida las env vars. Lanza si algo crítico falta.
 * Usar solo en bootstrap (main.ts) o en config providers.
 */
export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
