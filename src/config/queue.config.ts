import type { JobsOptions, QueueOptions, WorkerOptions } from 'bullmq';
import type { Env } from './env';

/**
 * Configuración centralizada de BullMQ.
 *
 * Diseño:
 *  - Una cola por tipo de trabajo (separación clara, no comparten retries
 *    ni concurrencias).
 *  - Concurrencia ajustable por cola — agent_run es CPU/IO intensivo (4
 *    paralelos), outbound es solo HTTP (puede escalar más).
 *  - Retención: guardamos N completos y M failed para debug y poder
 *    inspeccionar en BullBoard. No infinito (uso de Redis).
 *  - Retry con backoff exponencial — protege contra picos de error en
 *    APIs externas (Meta, Anthropic, OpenAI).
 *  - Prefix por entorno permite compartir Redis entre dev/staging/prod
 *    sin chocar jobs.
 *
 * Ver docs/01_ARCHITECTURE.md §2.2 para el rol de cada cola.
 */

// ============================================================================
// Nombres de colas (constantes — usar siempre estas, no strings hardcoded)
// ============================================================================

export const QUEUE_NAMES = {
  /** Webhook entrante → persistir + agrupar mensajes consecutivos. */
  INBOUND_MESSAGE: 'inbound-message',
  /** Disparar el agente (LLM call + tools + persistencia del turno). */
  AGENT_RUN: 'agent-run',
  /** Envío de mensajes salientes a Meta WhatsApp API. */
  OUTBOUND_MESSAGE: 'outbound-message',
  /** Indexación de catálogo: generar embeddings y guardar. */
  CATALOG_INDEXING: 'catalog-indexing',
  /** Invalidación de cache (cuando se actualiza catálogo/FAQ). */
  CACHE_INVALIDATION: 'cache-invalidation',
  /** Notificaciones al business (escalamientos, alertas). */
  NOTIFICATION: 'notification',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ============================================================================
// Opciones de conexión (compartidas entre Queue/Worker)
// ============================================================================

export function buildRedisConnection(env: Env) {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS ? {} : undefined,
    // Crítico para BullMQ: maxRetriesPerRequest debe ser null para conexiones
    // de worker (BullMQ maneja sus propios retries).
    maxRetriesPerRequest: null,
  };
}

// ============================================================================
// JobsOptions por defecto (aplican a TODOS los jobs salvo override explícito)
// ============================================================================

export function buildDefaultJobsOptions(env: Env): JobsOptions {
  return {
    attempts: env.BULLMQ_DEFAULT_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: env.BULLMQ_BACKOFF_INITIAL_MS,
    },
    // Retención: cuando un job completa, mantiene los últimos N en Redis.
    // Para failed: más alto (queremos poder debugear).
    removeOnComplete: {
      count: env.BULLMQ_KEEP_COMPLETED,
      // 7 días — más viejo que esto no aporta a debug.
      age: 7 * 24 * 60 * 60,
    },
    removeOnFail: {
      count: env.BULLMQ_KEEP_FAILED,
      age: 30 * 24 * 60 * 60,
    },
  };
}

// ============================================================================
// QueueOptions (al instanciar una Queue)
// ============================================================================

export function buildQueueOptions(env: Env): QueueOptions {
  return {
    connection: buildRedisConnection(env),
    prefix: env.BULLMQ_QUEUE_PREFIX,
    defaultJobOptions: buildDefaultJobsOptions(env),
  };
}

// ============================================================================
// WorkerOptions por cola (concurrencia + comportamiento)
// ============================================================================

/**
 * Builds WorkerOptions para una cola específica.
 *
 * @param queueName  nombre lógico (constante de QUEUE_NAMES)
 * @param env        env validado
 */
export function buildWorkerOptions(queueName: QueueName, env: Env): WorkerOptions {
  const concurrency = workerConcurrencyFor(queueName, env);

  return {
    connection: buildRedisConnection(env),
    prefix: env.BULLMQ_QUEUE_PREFIX,
    concurrency,
    // Jobs "atascados" (worker murió a mitad): se reclaman tras este timeout.
    stalledInterval: env.BULLMQ_STALLED_INTERVAL_MS,
    maxStalledCount: 2,
    // Lock que el worker mantiene mientras procesa un job.
    // Debe ser > tiempo máximo esperado de un job.
    lockDuration: 60_000,
    // Cuán seguido el worker renueva el lock (debe ser < lockDuration / 3).
    lockRenewTime: 15_000,
  };
}

function workerConcurrencyFor(queueName: QueueName, env: Env): number {
  switch (queueName) {
    case QUEUE_NAMES.INBOUND_MESSAGE:
      return env.BULLMQ_INBOUND_CONCURRENCY;
    case QUEUE_NAMES.AGENT_RUN:
      return env.BULLMQ_AGENT_CONCURRENCY;
    case QUEUE_NAMES.OUTBOUND_MESSAGE:
      return env.BULLMQ_OUTBOUND_CONCURRENCY;
    case QUEUE_NAMES.CATALOG_INDEXING:
      return env.BULLMQ_INDEXING_CONCURRENCY;
    case QUEUE_NAMES.CACHE_INVALIDATION:
      return 4;
    case QUEUE_NAMES.NOTIFICATION:
      return 4;
  }
}

// ============================================================================
// Job options específicas por tipo (overrides al default)
// ============================================================================

/**
 * Agent runs son caros — fail-fast tras pocos intentos para no quemar tokens.
 */
export function agentRunJobOptions(env: Env): JobsOptions {
  return {
    ...buildDefaultJobsOptions(env),
    attempts: 2,
    backoff: { type: 'exponential', delay: 2000 },
  };
}

/**
 * Outbound a Meta — la API puede tener rate limits, queremos más reintentos.
 */
export function outboundMessageJobOptions(env: Env): JobsOptions {
  return {
    ...buildDefaultJobsOptions(env),
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
  };
}

/**
 * Inbound message con delay configurable para implementar la ventana de
 * agrupación (FR-5). El job se ejecuta tras WEBHOOK_GROUPING_WINDOW_MS,
 * juntando mensajes consecutivos del mismo cliente.
 */
export function inboundMessageJobOptions(env: Env): JobsOptions {
  return {
    ...buildDefaultJobsOptions(env),
    delay: env.WEBHOOK_GROUPING_WINDOW_MS,
    // Permite que un job nuevo del mismo cliente REEMPLACE al pendiente.
    // El service que encola debe pasar un jobId determinístico por
    // (business_id, customer_phone).
  };
}

// ============================================================================
// Tipos de jobs (payload contracts — usados en producer y consumer)
// ============================================================================

export interface InboundMessageJobData {
  inboundMessageId: string; // UUID en DB
  businessId: string;
  customerPhone: string;
}

export interface AgentRunJobData {
  conversationId: string;
  businessId: string;
  /** IDs de mensajes nuevos a procesar en este turno (post-ventana de agrupación). */
  newMessageIds: string[];
}

export interface OutboundMessageJobData {
  businessId: string;
  to: string;
  text: string;
  /** Para idempotencia y trazabilidad. */
  conversationId: string;
  agentRunId: string;
}

export interface CatalogIndexingJobData {
  businessId: string;
  /** IDs específicos a re-indexar; si undefined, todo el catálogo del business. */
  productIds?: string[];
}

export interface CacheInvalidationJobData {
  businessId: string;
  /** Si se omite, invalida toda la cache del business. */
  scope?: 'catalog' | 'faq' | 'business_info';
}

export interface NotificationJobData {
  businessId: string;
  type: 'escalation' | 'budget_exceeded' | 'system_alert';
  payload: Record<string, unknown>;
}
