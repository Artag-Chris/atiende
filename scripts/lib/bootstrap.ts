import 'reflect-metadata';
import { existsSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@modules/persistence/postgres/prisma.service';
import { OpenAIEmbeddingsAdapter } from '@modules/embeddings/openai/openai-embeddings.adapter';
import { PgvectorSemanticCacheAdapter } from '@modules/cache/semantic/pgvector-semantic-cache.adapter';
import { buildAIConfig } from '@config/ai.config';
import { buildFeatures } from '@config/features';
import { loadEnv, type Env } from '@config/env';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';

/**
 * Utilidades compartidas por los scripts de ingesta (scripts/*.ts).
 *
 * No levantan el contexto de Nest a propósito: `NestFactory` arrastraría
 * Redis/BullMQ y el CLI podría colgarse si Redis no está arriba. Estos scripts
 * solo hablan con Postgres y con la API de embeddings.
 */

/**
 * Carga `.env` en process.env. `process.loadEnvFile` existe desde Node 20.12;
 * si no está, se asume que las variables ya vienen del entorno (Prisma también
 * carga `.env` por su cuenta, que es lo que hace funcionar a prisma:seed).
 */
export function loadDotEnv(): void {
  if (!existsSync('.env')) {
    console.warn('Aviso: no se encontró .env en el directorio actual.');
    return;
  }

  const loader = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void })
    .loadEnvFile;

  if (typeof loader !== 'function') {
    console.warn(
      'Aviso: este Node no soporta process.loadEnvFile (requiere >=20.12); ' +
        'se asume que las variables de entorno ya están cargadas.',
    );
    return;
  }

  loader.call(process, '.env');
}

export function createPrisma(): PrismaService {
  return new PrismaService();
}

export function createEnv(): Env {
  return loadEnv();
}

export function createEmbedder(env: Env): EmbeddingProviderPort {
  return new OpenAIEmbeddingsAdapter(buildAIConfig(env), new ConfigService());
}

/**
 * Caché semántica para invalidarla tras re-indexar. Solo necesita Prisma y el
 * embedder (la caché exacta vive en Redis y no se toca desde estos scripts).
 */
export function createSemanticCache(
  prisma: PrismaService,
  embedder: EmbeddingProviderPort,
  env: Env,
): PgvectorSemanticCacheAdapter {
  return new PgvectorSemanticCacheAdapter(prisma, embedder, buildFeatures(env));
}

/**
 * Resuelve el business por id, por whatsappPhoneId, o el primero si se omite.
 * Mismo criterio que `prisma/seed-channel-accounts.ts`.
 */
export async function resolveBusinessId(prisma: PrismaService, arg?: string): Promise<string> {
  if (arg) {
    const byId = await prisma.business.findUnique({ where: { id: arg } }).catch(() => null);
    if (byId) return byId.id;

    const byPhone = await prisma.business.findUnique({ where: { whatsappPhoneId: arg } });
    if (byPhone) return byPhone.id;

    throw new Error(`No se encontró un business con id ni whatsappPhoneId="${arg}".`);
  }

  const first = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!first) {
    throw new Error('No hay businesses en la base de datos. Corre el seed primero.');
  }
  return first.id;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parser mínimo: `--flag valor`, `--flag=valor` y `--bool`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf('=');

    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      index += 1;
    } else {
      flags[body] = true;
    }
  }

  return { positionals, flags };
}

export function flagString(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}
