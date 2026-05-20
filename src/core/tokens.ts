/**
 * Tokens de inyección de dependencias (NestJS DI).
 *
 * Los ports se inyectan vía estos tokens para que el core no dependa
 * de las implementaciones concretas. Cada modulo registra el provider
 * concreto para el token correspondiente.
 */

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
export const LLM_PROVIDER_FALLBACK = Symbol('LLM_PROVIDER_FALLBACK');
export const CHANNEL_PROVIDER = Symbol('CHANNEL_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
export const RESPONSE_CACHE = Symbol('RESPONSE_CACHE');
export const EXACT_CACHE = Symbol('EXACT_CACHE');
export const FEATURES = Symbol('FEATURES');
export const TOOL_MODULES = Symbol('TOOL_MODULES');
