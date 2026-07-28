import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { buildFeatures } from './config/features';
import { mapLogLevels } from './common/utils/logger.utils';
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, features), {
    bufferLogs: false,
    logger: mapLogLevels(env.LOG_LEVEL),
    bodyParser: true,
    rawBody: true,
  });

  app.useBodyParser('json', { limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb` });
  app.useBodyParser('urlencoded', {
    limit: `${env.WEBHOOK_BODY_SIZE_LIMIT_KB}kb`,
    extended: true,
  });

  app.use(helmet());

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
