/**
 * Tokens de inyección de dependencias (NestJS DI).
 *
 * TODOS los tokens del proyecto viven aquí — una sola fuente de verdad.
 * Convención: `<NOMBRE>_TOKEN` para evitar colisiones con tipos del mismo nombre.
 *
 * Los ports se inyectan vía estos tokens para que el core no dependa
 * de las implementaciones concretas. Cada módulo registra el provider
 * concreto para el token correspondiente.
 */

// ----- Config ----------------------------------------------------------------
export const ENV_TOKEN = Symbol('ENV');
export const FEATURES_TOKEN = Symbol('FEATURES');
export const AI_CONFIG_TOKEN = Symbol('AI_CONFIG');
export const CIRCUIT_BREAKER_CONFIG_TOKEN = Symbol('CIRCUIT_BREAKER_CONFIG');

// ----- LLM providers ---------------------------------------------------------
export const LLM_PROVIDER_TOKEN = Symbol('LLM_PROVIDER');
export const LLM_PROVIDER_FALLBACK_TOKEN = Symbol('LLM_PROVIDER_FALLBACK');

// ----- Embeddings ------------------------------------------------------------
export const EMBEDDING_PROVIDER_TOKEN = Symbol('EMBEDDING_PROVIDER');

// ----- Channels (multi-binding: pueden ser varios habilitados a la vez) ------
export const CHANNEL_PROVIDERS_TOKEN = Symbol('CHANNEL_PROVIDERS');

// ----- Caching (capas independientes) ----------------------------------------
export const EXACT_CACHE_TOKEN = Symbol('EXACT_CACHE');
export const SEMANTIC_CACHE_TOKEN = Symbol('SEMANTIC_CACHE');

// ----- Tools (multi-binding: el agente recibe todas las habilitadas) ---------
export const TOOL_MODULES_TOKEN = Symbol('TOOL_MODULES');
export const RESPONSE_POLICY_TOKEN = Symbol('RESPONSE_POLICY');

// ----- Knowledge ingestion (multi-binding de extractors según MIME) ----------
export const DOCUMENT_EXTRACTORS_TOKEN = Symbol('DOCUMENT_EXTRACTORS');
export const CHUNKER_TOKEN = Symbol('CHUNKER');

// ----- Persistence -----------------------------------------------------------
export const AGENT_RUN_REPOSITORY_TOKEN = Symbol('AGENT_RUN_REPOSITORY');
export const BUSINESS_REPOSITORY_TOKEN = Symbol('BUSINESS_REPOSITORY');
export const CONVERSATION_REPOSITORY_TOKEN = Symbol('CONVERSATION_REPOSITORY');
export const MESSAGE_REPOSITORY_TOKEN = Symbol('MESSAGE_REPOSITORY');
export const INBOUND_MESSAGE_REPOSITORY_TOKEN = Symbol('INBOUND_MESSAGE_REPOSITORY');
export const UNIT_OF_WORK_TOKEN = Symbol('UNIT_OF_WORK');

// ----- Infrastructure -------------------------------------------------------
export const REDIS_CLIENT_TOKEN = Symbol('REDIS_CLIENT');

// ============================================================================
// DEPRECATED — mantener temporalmente para no romper imports en módulos viejos.
// Eliminar tras migrar todos los consumers a los `_TOKEN` aliases.
// ============================================================================

/** @deprecated Use FEATURES_TOKEN. */
export const FEATURES = FEATURES_TOKEN;
/** @deprecated Use LLM_PROVIDER_TOKEN. */
export const LLM_PROVIDER = LLM_PROVIDER_TOKEN;
/** @deprecated Use LLM_PROVIDER_FALLBACK_TOKEN. */
export const LLM_PROVIDER_FALLBACK = LLM_PROVIDER_FALLBACK_TOKEN;
/** @deprecated Use CHANNEL_PROVIDERS_TOKEN (multi-binding). */
export const CHANNEL_PROVIDER = CHANNEL_PROVIDERS_TOKEN;
/** @deprecated Use EMBEDDING_PROVIDER_TOKEN. */
export const EMBEDDING_PROVIDER = EMBEDDING_PROVIDER_TOKEN;
/** @deprecated Use EXACT_CACHE_TOKEN or SEMANTIC_CACHE_TOKEN. */
export const RESPONSE_CACHE = SEMANTIC_CACHE_TOKEN;
/** @deprecated Use EXACT_CACHE_TOKEN. */
export const EXACT_CACHE = EXACT_CACHE_TOKEN;
/** @deprecated Use TOOL_MODULES_TOKEN. */
export const TOOL_MODULES = TOOL_MODULES_TOKEN;
