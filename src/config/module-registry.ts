import type { DynamicModule, Type } from '@nestjs/common';
import type { Features } from './features';
import { WhatsAppModule } from '../modules/channels/whatsapp/whatsapp.module';

/**
 * Carga dinámica de módulos según feature flags.
 *
 * Esta función se llama desde AppModule.forRoot(). Devuelve la lista de
 * módulos a registrar (CoreModule siempre + los módulos habilitados).
 *
 * Ver docs/01_ARCHITECTURE.md §11.4 para el patrón completo.
 *
 * NOTA: los imports están comentados hasta que los módulos existan. A medida
 * que implementemos cada uno, los descomentamos y los importamos arriba.
 */
export function resolveModules(features: Features): Array<Type<unknown> | DynamicModule> {
  const modules: Array<Type<unknown> | DynamicModule> = [];

  // ----- Core (siempre) -----
  // modules.push(CoreModule);

  // ----- LLM primario -----
  // switch (features.llm.primary) {
  //   case 'claude': modules.push(ClaudeModule); break;
  //   case 'openai': modules.push(OpenAIModule); break;
  //   case 'mock':   modules.push(MockLlmModule); break;
  // }

  // ----- LLM fallback (opcional) -----
  // if (features.llm.fallback) { ... }

  // ----- Canales -----
  if (features.channels.whatsapp) modules.push(WhatsAppModule);
  // if (features.channels.webChat)  modules.push(WebChatModule);

  // ----- Tools -----
  // if (features.tools.catalog)    modules.push(CatalogToolModule);
  // if (features.tools.orders)     modules.push(OrdersToolModule);
  // if (features.tools.info)       modules.push(InfoToolModule);
  // if (features.tools.escalation) modules.push(EscalationToolModule);

  // ----- Embeddings -----
  // switch (features.embeddings.provider) {
  //   case 'openai': modules.push(OpenAIEmbeddingsModule); break;
  //   case 'voyage': modules.push(VoyageEmbeddingsModule); break;
  // }

  // ----- Caching -----
  // if (features.cache.exact)    modules.push(ExactCacheModule);
  // if (features.cache.semantic) modules.push(SemanticCacheModule);

  return modules;
}
