import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN } from '@core/tokens';
import { OpenAIAdapter } from './openai.adapter';

@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER_TOKEN,
      useExisting: OpenAIAdapter,
    },
    {
      provide: LLM_PROVIDER_FALLBACK_TOKEN,
      useExisting: OpenAIAdapter,
    },
    OpenAIAdapter,
  ],
  exports: [LLM_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN, OpenAIAdapter],
})
export class OpenAIModule {}
