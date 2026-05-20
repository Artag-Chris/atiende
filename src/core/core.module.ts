import { Module } from '@nestjs/common';

/**
 * CoreModule contiene la lógica de negocio del agente.
 * NO importa SDKs ni adapters concretos — solo habla con ports vía DI tokens.
 *
 * Los providers concretos (Claude, WhatsApp, Postgres, etc.) se inyectan
 * desde los módulos correspondientes en src/modules/. La elección de cuáles
 * cargar la hace el ModuleRegistry según las feature flags.
 */
@Module({
  imports: [],
  providers: [
    // Services del core se agregan aquí (AgentService, ConversationService, etc.)
    // a medida que los implementemos en las próximas semanas.
  ],
  exports: [],
})
export class CoreModule {}
