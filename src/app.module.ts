import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CoreModule } from './core/core.module';
import {
  AI_CONFIG_TOKEN,
  CIRCUIT_BREAKER_CONFIG_TOKEN,
  ENV_TOKEN,
  FEATURES_TOKEN,
} from './core/tokens';
import { buildFeatures, type Features } from './config/features';
import { loadEnv, type Env } from './config/env';
import { buildAIConfig, buildCircuitBreakerConfig } from './config/ai.config';
import { resolveModules } from './config/module-registry';

/**
 * AppModule raíz. Usa forRoot() para construir la composición de módulos
 * dinámicamente según env validado + feature flags.
 *
 * Ver docs/01_ARCHITECTURE.md §11.4.
 */
@Module({})
export class AppModule {
  static forRoot(env: Env, features: Features): DynamicModule {
    const aiConfig = buildAIConfig(env);
    const circuitBreakerConfig = buildCircuitBreakerConfig(env);

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true }),
        CoreModule,
        ...resolveModules(features),
      ],
      providers: [
        { provide: ENV_TOKEN, useValue: env },
        { provide: FEATURES_TOKEN, useValue: features },
        { provide: AI_CONFIG_TOKEN, useValue: aiConfig },
        { provide: CIRCUIT_BREAKER_CONFIG_TOKEN, useValue: circuitBreakerConfig },
      ],
      exports: [ENV_TOKEN, FEATURES_TOKEN, AI_CONFIG_TOKEN, CIRCUIT_BREAKER_CONFIG_TOKEN],
    };
  }

  /**
   * Variante para tests. Acepta env+features explícitos para que los tests no
   * dependan de `process.env`. Si no se pasan, intenta loadEnv() (útil cuando
   * el test setup ya cargó un .env.test).
   */
  static forTest(env?: Env, features?: Features): DynamicModule {
    const resolvedEnv = env ?? loadEnv();
    const resolvedFeatures = features ?? buildFeatures(resolvedEnv);
    return AppModule.forRoot(resolvedEnv, resolvedFeatures);
  }
}
