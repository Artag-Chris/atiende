import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CoreModule } from './core/core.module';
import { FEATURES } from './core/tokens';
import { buildFeatures, type Features } from './config/features';
import { loadEnv, type Env } from './config/env';
import { buildAIConfig } from './config/ai.config';
import { resolveModules } from './config/module-registry';

/**
 * AppModule raíz. Usa forRoot() para construir la composición de módulos
 * dinámicamente según env validado + feature flags.
 *
 * Ver docs/01_ARCHITECTURE.md §11.4.
 */

export const ENV_TOKEN = Symbol('ENV');
export const AI_CONFIG = Symbol('AI_CONFIG');

@Module({})
export class AppModule {
  static forRoot(env: Env, features: Features): DynamicModule {
    const aiConfig = buildAIConfig(env);

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true }),
        CoreModule,
        ...resolveModules(features),
      ],
      providers: [
        { provide: ENV_TOKEN, useValue: env },
        { provide: FEATURES, useValue: features },
        { provide: AI_CONFIG, useValue: aiConfig },
      ],
      exports: [ENV_TOKEN, FEATURES, AI_CONFIG],
    };
  }

  /**
   * Variante para tests: arma env+features con defaults sensatos y permite
   * overrides parciales.
   */
  static forTest(envOverrides?: Partial<Env>, featuresOverrides?: Partial<Features>): DynamicModule {
    // Para tests, levantamos un env mínimo viable y permitimos override.
    const baseEnv = loadEnv();
    const env: Env = { ...baseEnv, ...envOverrides };
    const features: Features = { ...buildFeatures(env), ...featuresOverrides };
    return AppModule.forRoot(env, features);
  }
}
