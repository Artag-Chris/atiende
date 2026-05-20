import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { buildFeatures } from './config/features';

/**
 * Entry point.
 *
 *  1. Valida env vars (fail-fast).
 *  2. Construye feature flags consolidadas.
 *  3. Construye AppModule dinámicamente según features.
 *  4. Aplica validation pipe global, helmet, CORS, body limits.
 *  5. Listen y wire de graceful shutdown con timeout.
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
    `Channels: ${
      Object.entries(features.channels)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || '(none)'
    }`,
  );
  logger.log(
    `Cache: exact=${features.cache.exact} semantic=${features.cache.semantic} (min sim ${features.cache.semanticMinSimilarity})`,
  );

  // Warning: production con prefijos de dev → casi seguro un error de config.
  if (env.NODE_ENV === 'production' && env.REDIS_PREFIX.includes('dev')) {
    logger.warn(
      `REDIS_PREFIX="${env.REDIS_PREFIX}" contiene 'dev' en NODE_ENV=production. Verificar config.`,
    );
  }

  // 3. Crear app. Body parser con limite explícito desde env.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, features), {
    bufferLogs: false,
    // Mapea LOG_LEVEL (pino-style) a niveles de NestJS Logger.
    logger: mapLogLevels(env.LOG_LEVEL),
    bodyParser: true,
    rawBody: true, // necesario para verificar firma HMAC de Meta sin parsearlo dos veces
  });

  // Body size limit (FR webhook + defensa anti-abuso).
  app.useBodyParser('json', { limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb` });
  app.useBodyParser('urlencoded', {
    limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb`,
    extended: true,
  });

  // 4. Security headers.
  app.use(helmet());

  // Validation pipe global.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS para dashboard.
  const corsOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    logger.warn('CORS_ALLOWED_ORIGINS está vacío. El dashboard no podrá conectar.');
  }
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Trust proxy (Railway, Cloudflare, Nginx, etc.).
  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  // Graceful shutdown. NestJS dispara los hooks; nosotros agregamos un timer
  // que mata el proceso si los hooks tardan demasiado (evita instances zombie).
  app.enableShutdownHooks();
  setupForceShutdown(env.SHUTDOWN_TIMEOUT_MS, logger);

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Atiende listening on http://0.0.0.0:${env.PORT}`);
}

/**
 * Mapea LOG_LEVEL (pino-style) a la lista de niveles que acepta el Logger
 * de NestJS. NestJS no soporta 'trace' nativo — se mapea a verbose.
 */
function mapLogLevels(
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
): Array<'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal'> {
  const order: Array<'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal'> = [
    'verbose',
    'debug',
    'log',
    'warn',
    'error',
    'fatal',
  ];
  const mapped = level === 'trace' ? 'verbose' : level === 'info' ? 'log' : level;
  const idx = order.indexOf(mapped);
  return order.slice(idx);
}

/**
 * Registra handler de SIGTERM/SIGINT que mata el proceso si NestJS no
 * termina sus shutdown hooks dentro del timeout. NestJS no expone esto
 * nativamente, así que lo wireamos a mano.
 */
function setupForceShutdown(timeoutMs: number, logger: Logger): void {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  signals.forEach((signal) => {
    process.once(signal, () => {
      logger.warn(`Received ${signal}. Allowing ${timeoutMs}ms to drain...`);
      setTimeout(() => {
        logger.error(`Shutdown timeout (${timeoutMs}ms) exceeded. Forcing exit.`);
        process.exit(1);
      }, timeoutMs).unref();
    });
  });
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
