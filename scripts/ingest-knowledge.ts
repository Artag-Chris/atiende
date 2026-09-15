import { existsSync, readFileSync } from 'fs';
import { basename, relative, resolve, sep } from 'path';
import { KnowledgeService } from '@modules/knowledge/knowledge.service';
import { KnowledgeDocumentRepository } from '@modules/persistence/postgres/knowledge-document.repository';
import { KnowledgeChunkRepository } from '@modules/persistence/postgres/knowledge-chunk.repository';
import { PdfExtractor } from '@modules/knowledge/extractors/pdf.extractor';
import { CsvExtractor } from '@modules/knowledge/extractors/csv.extractor';
import { MarkdownExtractor } from '@modules/knowledge/extractors/markdown.extractor';
import { ExcelExtractor } from '@modules/knowledge/extractors/excel.extractor';
import { TextChunker } from '@modules/knowledge/text-chunker';
import { resolveUploadType } from '@modules/knowledge/file-type';
import {
  createEmbedder,
  createEnv,
  createPrisma,
  createSemanticCache,
  flagString,
  loadDotEnv,
  parseArgs,
  resolveBusinessId,
} from './lib/bootstrap';

/**
 * Ingesta de conocimiento desde archivos, sin pasar por el seed ni por el panel.
 *
 * Usa la MISMA KnowledgeService que la API, así que idempotencia, chunking,
 * embeddings, estados e invalidación de caché se comportan igual.
 *
 * Uso:
 *   npm run knowledge:ingest -- ./contenido/precios-lumenx.md
 *   npm run knowledge:ingest -- ./precios.md --kind NOTES --title "Precios LumenX"
 *   npm run knowledge:ingest -- ./contenido/*.md --business 573001234567
 */

const KNOWLEDGE_KINDS = ['FAQ', 'POLICY', 'PDF_CATALOG', 'MANUAL', 'NOTES', 'OTHER'] as const;
type KnowledgeKindArg = (typeof KNOWLEDGE_KINDS)[number];

const USAGE = `
Ingesta de conocimiento en la base vectorial.

  npm run knowledge:ingest -- <archivo...> [opciones]

Opciones:
  --kind <tipo>       ${KNOWLEDGE_KINDS.join(' | ')}  (default: NOTES)
  --title <texto>     Título del documento (default: nombre del archivo)
  --source <id>       Identificador estable (default: ruta relativa del archivo).
                      Volver a usar el mismo --source ACTUALIZA el documento.
  --business <id>     businessId o whatsappPhoneId (default: el primer business)
  --dry-run           Solo valida y muestra qué haría, sin escribir nada
  --help              Muestra esta ayuda

Formatos: .md, .markdown, .txt, .pdf, .csv, .xlsx

Ejemplos:
  npm run knowledge:ingest -- ./contenido/precios-lumenx.md
  npm run knowledge:ingest -- ./precios.md --kind NOTES --title "Precios y servicios"
  npm run knowledge:ingest -- ./contenido/*.md
`;

interface Job {
  absolute: string;
  source: string;
  mimeType: string;
  ext: string;
}

/** Ruta normalizada con '/' para que `source` sea estable en cualquier SO. */
function toSourcePath(filePath: string): string {
  return relative(process.cwd(), resolve(filePath)).split(sep).join('/');
}

async function main(): Promise<void> {
  loadDotEnv();
  const { positionals, flags } = parseArgs(process.argv.slice(2));

  if (flags.help === true) {
    console.log(USAGE);
    return;
  }

  if (positionals.length === 0) {
    console.log(USAGE);
    process.exit(1);
  }

  const kindRaw = (flagString(flags, 'kind') ?? 'NOTES').toUpperCase();
  if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kindRaw)) {
    console.error(`--kind inválido: ${kindRaw}. Válidos: ${KNOWLEDGE_KINDS.join(', ')}`);
    process.exit(1);
  }
  const kind = kindRaw as KnowledgeKindArg;

  const sourceOverride = flagString(flags, 'source');
  const titleOverride = flagString(flags, 'title');
  const dryRun = flags['dry-run'] === true;

  if ((sourceOverride || titleOverride) && positionals.length > 1) {
    console.error('--source y --title solo aplican cuando se pasa un único archivo.');
    process.exit(1);
  }

  // Validación previa: así un path mal escrito falla antes de tocar la base.
  let failures = 0;
  const jobs: Job[] = [];

  for (const filePath of positionals) {
    const absolute = resolve(filePath);

    if (!existsSync(absolute)) {
      console.error(`✗ ${filePath} — no existe`);
      failures += 1;
      continue;
    }

    const type = resolveUploadType(absolute);
    if (!type.ok) {
      console.error(`✗ ${filePath} — ${type.reason}`);
      failures += 1;
      continue;
    }

    jobs.push({
      absolute,
      source: sourceOverride ?? toSourcePath(filePath),
      mimeType: type.mimeType,
      ext: type.ext,
    });
  }

  if (jobs.length === 0) process.exit(1);

  const env = createEnv();
  const prisma = createPrisma();
  await prisma.$connect();

  try {
    const embedder = createEmbedder(env);
    const businessId = await resolveBusinessId(prisma, flagString(flags, 'business'));

    const service = new KnowledgeService(
      new KnowledgeDocumentRepository(prisma),
      new KnowledgeChunkRepository(prisma),
      [new PdfExtractor(), new CsvExtractor(), new MarkdownExtractor(), new ExcelExtractor()],
      new TextChunker(),
      embedder,
      createSemanticCache(prisma, embedder, env),
    );

    console.log(`Business: ${businessId}`);
    console.log(`Tipo:     ${kind}`);
    console.log('');

    for (const job of jobs) {
      if (dryRun) {
        console.log(`· ${job.source} — se indexaría como ${kind} (.${job.ext})`);
        continue;
      }

      const before = await prisma.knowledgeDocument.findUnique({
        where: { businessId_source: { businessId, source: job.source } },
      });
      const previousIndexedAt = before?.indexedAt?.getTime() ?? null;

      try {
        const documentId = await service.ingestFromFile({
          businessId,
          kind,
          title: titleOverride ?? basename(job.absolute),
          source: job.source,
          content: readFileSync(job.absolute),
          mimeType: job.mimeType,
        });

        const after = await service.getDocument(documentId);
        const skipped =
          previousIndexedAt !== null && after?.indexedAt?.getTime() === previousIndexedAt;

        if (skipped) {
          console.log(`= ${job.source} — sin cambios (hash igual), no se re-indexó`);
        } else {
          console.log(
            `✓ ${job.source} — ${after?.chunkCount ?? 0} chunks · ${after?.status ?? 'INDEXED'}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ ${job.source} — ${message}`);
        failures += 1;
      }
    }

    console.log('');
    console.log(
      failures === 0
        ? `Listo: ${jobs.length} archivo(s) procesado(s).`
        : `${failures} de ${positionals.length} archivo(s) fallaron.`,
    );

    if (failures > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
