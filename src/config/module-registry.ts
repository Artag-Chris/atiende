import type { DynamicModule, Type } from '@nestjs/common';
import type { Features } from './features';
import type { LLMProviderName } from './ai.config';
import { WhatsAppModule } from '../modules/channels/whatsapp/whatsapp.module';
import { InstagramModule } from '../modules/channels/instagram/instagram.module';
import { MessengerModule } from '../modules/channels/messenger/messenger.module';
import { ChannelWebhookModule } from '../modules/channels/webhook/channel-webhook.module';
import { OpenAIModule } from '../modules/llm/openai/openai.module';
import { GeminiModule } from '../modules/llm/gemini/gemini.module';
import { GroqModule } from '../modules/llm/groq/groq.module';
import { KimiModule } from '../modules/llm/kimi/kimi.module';
import { MockLLMModule } from '../modules/llm/mock/mock-llm.module';
import { LLMRouterModule } from '../modules/llm/router/llm-router.module';
import { ChannelRouterModule } from '../modules/channels/router/channel-router.module';
import { PostgresPersistenceModule } from '../modules/persistence/postgres/postgres-persistence.module';
import { ToolsModule } from '../modules/tools/tools.module';
import { RedisModule } from '../modules/infrastructure/redis/redis.module';
import { RateLimitModule } from '../modules/infrastructure/rate-limit/rate-limit.module';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { MaintenanceModule } from '../modules/maintenance/maintenance.module';
import { PricingModule } from '../modules/pricing/pricing.module';
import { EmailModule } from '../modules/email/email.module';
import { SchedulingModule } from '../modules/scheduling/scheduling.module';
import { AuthModule } from '../modules/auth/auth.module';
import { HealthModule } from '../modules/health/health.module';
import { OpenAIEmbeddingsModule } from '../modules/embeddings/openai/openai-embeddings.module';
import { ResponsePolicyModule } from '../modules/response-policy/response-policy.module';
import { CacheModule } from '../modules/cache/cache.module';
import { EncryptionModule } from '../modules/infrastructure/encryption/encryption.module';

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
  modules.push(RateLimitModule);
  modules.push(EncryptionModule);
  modules.push(ChannelWebhookModule);

  // ----- Health (siempre habilitada — liveness/readiness para orquestación) -----
  modules.push(HealthModule);

  // ----- Tools (siempre habilitadas) -----
  modules.push(ToolsModule);

  // ----- LLM providers (primario + fallback) -----
  // Los módulos provider registran su adapter con el bloque de config correcto
  // (primary o fallback según las feature flags). LLMRouterModule ata los
  // adapters a los tokens de rol y expone LLMRouterService como LLM_PROVIDER_TOKEN.
  modules.push(providerModuleFor(features.llm.primary));
  if (features.llm.fallback && features.llm.fallback !== features.llm.primary) {
    modules.push(providerModuleFor(features.llm.fallback));
  }
  modules.push(LLMRouterModule.forRoot(features.llm.primary, features.llm.fallback));

  // ----- Router de canales (siempre presente; los providers se registran en
  // CHANNEL_PROVIDERS_TOKEN desde cada módulo de canal según feature flags) -----
  modules.push(ChannelRouterModule);

  // ----- Canales -----
  if (features.channels.whatsapp) modules.push(WhatsAppModule);
  if (features.channels.instagram) modules.push(InstagramModule);
  if (features.channels.messenger) modules.push(MessengerModule);
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

  // ----- Mantenimiento (siempre habilitado — jobs repeatable) -----
  modules.push(MaintenanceModule);

  // ----- Pricing (crons semanal de precios + diario del dólar) -----
  if (features.tools.estimatePrice) modules.push(PricingModule);

  // ----- Email + agendamiento (tool schedule_call) -----
  if (features.tools.scheduleCall) {
    modules.push(EmailModule);
    modules.push(SchedulingModule);
  }

  return modules;
}

function providerModuleFor(provider: LLMProviderName): Type<unknown> {
  switch (provider) {
    case 'openai':
      return OpenAIModule;
    case 'gemini':
      return GeminiModule;
    case 'groq':
      return GroqModule;
    case 'kimi':
      return KimiModule;
    default:
      // 'claude' (sin adapter implementado) y 'mock' caen al mock.
      return MockLLMModule;
  }
}
