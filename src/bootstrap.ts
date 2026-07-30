import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { buildFeatures } from './config/features';
import { mapLogLevels } from './common/utils/logger.utils';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JsonLogger } from './common/logger/json-logger.service';
import { setupForceShutdown } from './common/utils/shutdown.utils';

export async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const env = loadEnv();
  logger.log(`Environment: ${env.NODE_ENV}`);

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

  if (env.NODE_ENV === 'production' && env.REDIS_PREFIX.includes('dev')) {
    logger.warn(
      `REDIS_PREFIX="${env.REDIS_PREFIX}" contains 'dev' in NODE_ENV=production. Verify config.`,
    );
  }

  const loggerInstance =
    env.LOG_FORMAT === 'json'
      ? new JsonLogger(
          env.LOG_LEVEL === 'trace' ? 'verbose' : env.LOG_LEVEL === 'info' ? 'log' : env.LOG_LEVEL,
        )
      : mapLogLevels(env.LOG_LEVEL);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, features), {
    bufferLogs: env.LOG_FORMAT === 'json',
    logger: loggerInstance,
    bodyParser: true,
    rawBody: true,
  });

  app.useBodyParser('json', { limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb` });
  app.useBodyParser('urlencoded', {
    limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb`,
    extended: true,
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'none'"],
          'upgrade-insecure-requests': [],
          'base-uri': ["'none'"],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginEmbedderPolicy: { policy: 'require-corp' },
      originAgentCluster: true,
      dnsPrefetchControl: { allow: false },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      xContentTypeOptions: true,
      xDownloadOptions: true,
      xFrameOptions: { action: 'deny' },
      xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
      xPoweredBy: false,
      xXssProtection: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const rawOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawOrigins.length === 0) {
    logger.warn('CORS_ALLOWED_ORIGINS is empty. Dashboard will not connect.');
  }
  if (env.NODE_ENV === 'production' && rawOrigins.includes('*')) {
    logger.warn(
      'CORS allows all origins (*) in production. Set CORS_ALLOWED_ORIGINS to specific URLs.',
    );
  }
  const corsOrigins = rawOrigins.includes('*') ? '*' : rawOrigins;
  app.enableCors({
    origin: corsOrigins,
    credentials: corsOrigins !== '*',
  });

  if (env.TRUST_PROXY > 0) {
    app.set('trust proxy', env.TRUST_PROXY);
  }

  app.enableShutdownHooks();
  setupForceShutdown(env.SHUTDOWN_TIMEOUT_MS, logger);

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Atiende listening on http://0.0.0.0:${env.PORT}`);
}
