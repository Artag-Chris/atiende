import { Module } from '@nestjs/common';
import { ExactCacheAdapter } from './exact/exact-cache.adapter';
import { EXACT_CACHE_TOKEN } from '@core/tokens';

@Module({
  providers: [
    {
      provide: EXACT_CACHE_TOKEN,
      useClass: ExactCacheAdapter,
    },
  ],
  exports: [EXACT_CACHE_TOKEN],
})
export class CacheModule {}
