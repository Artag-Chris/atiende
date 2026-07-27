import { Global, Module, type DynamicModule } from '@nestjs/common';
import {
  AI_CONFIG_TOKEN,
  CIRCUIT_BREAKER_CONFIG_TOKEN,
  ENV_TOKEN,
  FEATURES_TOKEN,
} from '@core/tokens';
import type { AIConfig, CircuitBreakerConfig } from './ai.config';
import type { Env } from './env';
import type { Features } from './features';

/**
 * Módulo global que provee tokens de configuración (AI_CONFIG, CIRCUIT_BREAKER, etc.).
 *
 * Es @Global() para que cualquier módulo en la aplicación pueda acceder a estos
 * tokens sin necesidad de importarlo explícitamente. Esto resuelve el problema
 * de que módulos importados por AppModule (como OpenAIModule) no pueden acceder
 * a providers definidos directamente en el DynamicModule de AppModule.
 *
 * Se importa UNA VEZ en AppModule.forRoot().
 */
@Global()
@Module({})
export class ConfigProviderModule {
  static forRoot(
    env: Env,
    features: Features,
    aiConfig: AIConfig,
    circuitBreakerConfig: CircuitBreakerConfig,
  ): DynamicModule {
    return {
      module: ConfigProviderModule,
      providers: [
        { provide: ENV_TOKEN, useValue: env },
        { provide: FEATURES_TOKEN, useValue: features },
        { provide: AI_CONFIG_TOKEN, useValue: aiConfig },
        { provide: CIRCUIT_BREAKER_CONFIG_TOKEN, useValue: circuitBreakerConfig },
      ],
      exports: [ENV_TOKEN, FEATURES_TOKEN, AI_CONFIG_TOKEN, CIRCUIT_BREAKER_CONFIG_TOKEN],
    };
  }
}
