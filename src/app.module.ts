import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CoreModule } from './core/core.module';
import { FEATURES } from './core/tokens';
import { loadFeatures, type Features } from './config/features';
import { resolveModules } from './config/module-registry';

/**
 * AppModule raíz. Usa el patrón forRoot() para construir la composición
 * de módulos dinámicamente según las feature flags actuales.
 *
 * Bootstrap:
 *   const features = loadFeatures();
 *   const app = await NestFactory.create(AppModule.forRoot(features));
 *
 * Ver docs/01_ARCHITECTURE.md §11.4.
 */
@Module({})
export class AppModule {
  static forRoot(features: Features): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true }),
        CoreModule,
        ...resolveModules(features),
      ],
      providers: [
        {
          provide: FEATURES,
          useValue: features,
        },
      ],
      exports: [FEATURES],
    };
  }

  /** Variante para tests: features explícitas, no leídas de env. */
  static forTest(features?: Partial<Features>): DynamicModule {
    const defaults = loadFeatures({} as NodeJS.ProcessEnv);
    return AppModule.forRoot({ ...defaults, ...features });
  }
}
