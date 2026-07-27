import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN } from '@core/tokens';
import { GroqAdapter } from './groq.adapter';

@Global()
@Module({
  providers: [
    GroqAdapter,
    { provide: LLM_PROVIDER_TOKEN, useExisting: GroqAdapter },
    { provide: LLM_PROVIDER_FALLBACK_TOKEN, useExisting: GroqAdapter },
  ],
  exports: [LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN, GroqAdapter],
})
export class GroqModule {}
