import type { DynamicModule, Type } from '@nestjs/common';
import type { Features } from './features';
import { WhatsAppModule } from '../modules/channels/whatsapp/whatsapp.module';
import { OpenAIModule } from '../modules/llm/openai/openai.module';
import { GeminiModule } from '../modules/llm/gemini/gemini.module';
import { GroqModule } from '../modules/llm/groq/groq.module';
import { MockLLMModule } from '../modules/llm/mock/mock-llm.module';
import { PostgresPersistenceModule } from '../modules/persistence/postgres/postgres-persistence.module';
import { ToolsModule } from '../modules/tools/tools.module';
import { RedisModule } from '../modules/infrastructure/redis/redis.module';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { AuthModule } from '../modules/auth/auth.module';
import { OpenAIEmbeddingsModule } from '../modules/embeddings/openai/openai-embeddings.module';
import { ResponsePolicyModule } from '../modules/response-policy/response-policy.module';
import { CacheModule } from '../modules/cache/cache.module';

/**
 * Carga dinámica de módulos según feature flags.
 *
 * Esta función se llama desde AppModule.forRoot(). Devuelve la lista de
 * módulos a registrar (CoreModule siempre + los módulos habilitados).
 *
 * Ver docs/01_ARCHITECTURE.md §11.4 para el patrón completo.
 */
export function resolveModules(features: Features): Array<Type<unknown> | DynamicModule> {
  const modules: Array<Type<unknown> | DynamicModule> = [];

  // ----- Persistencia (siempre habilitada) -----
  modules.push(PostgresPersistenceModule);

  // ----- Infrastructure (siempre habilitada) -----
  modules.push(RedisModule);

  // ----- Tools (siempre habilitadas) -----
  modules.push(ToolsModule);

  // ----- LLM primario -----
  switch (features.llm.primary) {
    case 'openai':
      modules.push(OpenAIModule);
      break;
    case 'gemini':
      modules.push(GeminiModule);
      break;
    case 'groq':
      modules.push(GroqModule);
      break;
    // case 'claude': modules.push(ClaudeModule); break;
    default:
      modules.push(MockLLMModule);
      break;
  }

  // ----- LLM fallback (opcional) -----
  // NOTA: El módulo de fallback NO se carga actualmente porque tanto GroqModule
  // como OpenAIModule registran LLM_PROVIDER_TOKEN, y el último en cargarse pisa
  // al primario. Cuando exista un LLMRouterService que use LLM_PROVIDER_FALLBACK_TOKEN
  // por separado, habilitar esto con módulos que registren solo el token de fallback.
  // if (features.llm.fallback === 'openai' && features.llm.primary !== 'openai') {
  //   modules.push(OpenAIModule);
  // } else if (features.llm.fallback === 'groq' && features.llm.primary !== 'groq') {
  //   modules.push(GroqModule);
  // } else if (features.llm.fallback === 'gemini' && features.llm.primary !== 'gemini') {
  //   modules.push(GeminiModule);
  // }

  // ----- Canales -----
  if (features.channels.whatsapp) modules.push(WhatsAppModule);
  // if (features.channels.webChat)  modules.push(WebChatModule);
  // if (features.channels.telegram) modules.push(TelegramModule);

  // ----- Tools -----
  // if (features.tools.catalog)    modules.push(CatalogToolModule);
  // if (features.tools.orders)     modules.push(OrdersToolModule);
  // if (features.tools.info)       modules.push(InfoToolModule);
  // if (features.tools.escalation) modules.push(EscalationToolModule);

  // ----- Knowledge (feature-flagged) -----
  if (features.tools.knowledgeSearch) modules.push(KnowledgeModule);

  // ----- Response Policy (feature-flagged) -----
  if (features.ai.scopeGuard) modules.push(ResponsePolicyModule);

  // ----- Embeddings -----
  switch (features.embeddings.provider) {
    case 'openai':
      modules.push(OpenAIEmbeddingsModule);
      break;
  }

  // ----- Caching -----
  if (features.cache.exact || features.cache.semantic) modules.push(CacheModule);

  // ----- Auth (siempre habilitado) -----
  modules.push(AuthModule);

  // ----- Dashboard API (siempre habilitado) -----
  modules.push(DashboardModule);

  return modules;
}
