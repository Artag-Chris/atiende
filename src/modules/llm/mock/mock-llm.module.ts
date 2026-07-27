import { Module } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN } from '@core/tokens';
import { MockLLMAdapter } from './mock-llm.adapter';

@Module({
  providers: [
    MockLLMAdapter,
    { provide: LLM_PROVIDER_TOKEN, useExisting: MockLLMAdapter },
    { provide: LLM_PROVIDER_FALLBACK_TOKEN, useExisting: MockLLMAdapter },
  ],
  exports: [LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN],
})
export class MockLLMModule {}
