import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CoreModule } from './core/core.module';
import { buildFeatures, type Features } from './config/features';
import { loadEnv, type Env } from './config/env';
import { buildAIConfig, buildCircuitBreakerConfig } from './config/ai.config';
import { resolveModules } from './config/module-registry';
import { ConfigProviderModule } from './config/config-provider.module';

/**
 * AppModule raíz. Usa forRoot() para construir la composición de módulos
 * dinámicamente según env validado + feature flags.
 *
 * Los tokens de configuración (AI_CONFIG, CIRCUIT_BREAKER, etc.) se proveen
 * vía ConfigProviderModule (@Global), no directamente en este módulo, para que
 * módulos importados como OpenAIModule puedan acceder a ellos.
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
        ConfigProviderModule.forRoot(env, features, aiConfig, circuitBreakerConfig),
        CoreModule,
        ...resolveModules(features),
      ],
      providers: [],
      exports: [],
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
