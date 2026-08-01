import { Global, Module } from '@nestjs/common';
import { MockLLMAdapter } from './mock-llm.adapter';

/**
 * Mock sin dependencias: se usa cuando el provider configurado no tiene
 * adapter implementado (p.ej. 'claude'). No registra los tokens de rol —
 * esos los ata LLMRouterModule.
 */
@Global()
@Module({
  providers: [MockLLMAdapter],
  exports: [MockLLMAdapter],
})
export class MockLLMModule {}
