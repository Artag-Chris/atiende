import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { buildFeatures } from './config/features';

/**
 * Entry point.
 *
 *  1. Valida env vars (fail-fast).
 *  2. Construye feature flags consolidadas.
 *  3. Construye AppModule dinámicamente según features.
 *  4. Aplica validation pipe global y arranca el servidor HTTP.
 *  5. Graceful shutdown con timeout.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // 1. Validar entorno. Si algo crítico falta, lanza y muere.
  const env = loadEnv();
  logger.log(`Environment: ${env.NODE_ENV}`);

  // 2. Construir features a partir del env validado.
  const features = buildFeatures(env);
  logger.log(`LLM primary: ${features.llm.primary} / fallback: ${features.llm.fallback ?? 'none'}`);
  logger.log(
    `Channels: ${Object.entries(features.channels)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ') || '(none)'}`,
  );
  logger.log(
    `Cache: exact=${features.cache.exact} semantic=${features.cache.semantic} (min sim ${features.cache.semanticMinSimilarity})`,
  );

  // 3. Crear app con el grafo de módulos resuelto por features.
  const app = await NestFactory.create(AppModule.forRoot(env, features), {
    bufferLogs: false,
  });

  // 4. Pipes globales.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS para dashboard.
  const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Trust proxy si está detrás de balanceador.
  if (env.TRUST_PROXY > 0) {
    const http = app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void };
    http.set?.('trust proxy', env.TRUST_PROXY);
  }

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
