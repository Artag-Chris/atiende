import { z } from 'zod';

/**
 * Schema de validación de variables de entorno.
 * Se valida al arrancar la app (fail-fast: si falta una env crítica, no arranca).
 */
export const EnvSchema = z.object({
  // ----- App -----
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ----- Database -----
  DATABASE_URL: z.string().url(),

  // ----- Redis -----
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // ----- LLM providers -----
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  // ----- WhatsApp / Meta -----
  META_APP_SECRET: z.string().min(1, 'META_APP_SECRET is required for webhook signature verification'),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1, 'META_WEBHOOK_VERIFY_TOKEN is required'),

  // ----- Encryption -----
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

  // ----- Observability -----
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('atiende'),
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
