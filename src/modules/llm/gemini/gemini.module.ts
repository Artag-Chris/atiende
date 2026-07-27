import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN } from '@core/tokens';
import { GeminiAdapter } from './gemini.adapter';

@Global()
@Module({
  providers: [
    GeminiAdapter,
    { provide: LLM_PROVIDER_TOKEN, useExisting: GeminiAdapter },
    { provide: LLM_PROVIDER_FALLBACK_TOKEN, useExisting: GeminiAdapter },
  ],
  exports: [LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN, GeminiAdapter],
})
export class GeminiModule {}
