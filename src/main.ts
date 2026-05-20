import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { loadFeatures } from './config/features';

/**
 * Entry point.
 *
 *  1. Valida env vars (fail-fast).
 *  2. Carga feature flags.
 *  3. Construye AppModule dinámicamente según features.
 *  4. Aplica validation pipe global y arranca el servidor HTTP.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // 1. Validar entorno. Si algo crítico falta, lanza y muere.
  const env = loadEnv();
  logger.log(`Environment: ${env.NODE_ENV}`);

  // 2. Cargar feature flags.
  const features = loadFeatures();
  logger.log(`LLM primary: ${features.llm.primary}, fallback: ${features.llm.fallback ?? 'none'}`);
  logger.log(
    `Channels enabled: ${Object.entries(features.channels)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || '(none)'}`,
  );

  // 3. Crear app con el grafo de módulos resuelto por features.
  const app = await NestFactory.create(AppModule.forRoot(features), {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  // 4. Pipes globales.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Graceful shutdown.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`🚀 Atiende listening on http://0.0.0.0:${env.PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
