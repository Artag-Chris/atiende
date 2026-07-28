import { Module } from '@nestjs/common';
import { AgentService } from './services/agent.service';
import { ProcessInboundMessageUseCase } from './use-cases/process-inbound-message';

/**
 * CoreModule contiene la lógica de negocio del agente.
 * NO importa SDKs ni adapters concretos — solo habla con ports vía DI tokens.
 *
 * Los providers concretos (OpenAI, WhatsApp, Postgres, etc.) se inyectan
 * desde los módulos correspondientes en src/modules/. La elección de cuáles
 * cargar la hace el ModuleRegistry según las feature flags.
 */
@Module({
  imports: [],
  providers: [AgentService, ProcessInboundMessageUseCase],
  exports: [AgentService, ProcessInboundMessageUseCase],
})
export class CoreModule {}
