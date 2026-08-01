import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting global (infra compartida entre canales: WhatsApp, IG, Messenger).
 * Cada canal marca sus endpoints de verificación con @SkipThrottle().
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 600 }],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
