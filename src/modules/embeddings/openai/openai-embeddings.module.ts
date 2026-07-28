import { Global, Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER_TOKEN } from '@core/tokens';
import { OpenAIEmbeddingsAdapter } from './openai-embeddings.adapter';

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER_TOKEN,
      useClass: OpenAIEmbeddingsAdapter,
    },
  ],
  exports: [EMBEDDING_PROVIDER_TOKEN],
})
export class OpenAIEmbeddingsModule {}
