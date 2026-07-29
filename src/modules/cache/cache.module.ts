import { Global, Module } from '@nestjs/common';
import { ExactCacheAdapter } from './exact/exact-cache.adapter';
import { PgvectorSemanticCacheAdapter } from './semantic/pgvector-semantic-cache.adapter';
import { EXACT_CACHE_TOKEN, SEMANTIC_CACHE_TOKEN } from '@core/tokens';

@Global()
@Module({
  providers: [
    {
      provide: EXACT_CACHE_TOKEN,
      useClass: ExactCacheAdapter,
    },
    {
      provide: SEMANTIC_CACHE_TOKEN,
      useClass: PgvectorSemanticCacheAdapter,
    },
  ],
  exports: [EXACT_CACHE_TOKEN, SEMANTIC_CACHE_TOKEN],
})
export class CacheModule {}
