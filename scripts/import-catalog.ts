import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';
import { cell, mapColumns, parseCsv, parseInteger, parsePrice } from '@modules/catalog/catalog-csv';
import { productEmbeddingText } from '@modules/catalog/product-embedding';
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
 * Importa/actualiza el catálogo de servicios y precios desde un CSV y lo
 * vectoriza. Es la vía estructurada para que `search_catalog`, `get_product` y
 * `estimate_price` trabajen con precios reales.
 *
 * Uso:
 *   npm run catalog:import -- ./servicios.csv
 *   npm run catalog:import -- ./servicios.csv --dry-run
 */

const PAGE_SIZE = 100;

const USAGE = `
Importa catálogo y precios desde CSV.

  npm run catalog:import -- <archivo.csv> [opciones]

Opciones:
  --business <id>   businessId o whatsappPhoneId (default: el primer business)
  --dry-run         Muestra qué haría sin escribir en la base
  --help            Muestra esta ayuda

Columnas: name,description,price,stock,category,image_url
Solo "name" es obligatorio. Para actualizar un producto, repite su nombre.
`;

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

  if (positionals.length > 1) {
    console.error('Este comando importa un CSV a la vez.');
    process.exit(1);
  }

  const dryRun = flags['dry-run'] === true;
  const absolute = resolve(positionals[0]);

  if (!existsSync(absolute)) {
    console.error(`No existe el archivo: ${absolute}`);
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(absolute, 'utf-8'));
  if (rows.length < 2) {
    console.error('El CSV necesita una cabecera y al menos una fila de datos.');
    process.exit(1);
  }

  const columns = mapColumns(rows[0]);
  if (columns.name < 0) {
    console.error('Falta la columna obligatoria "name" (o "nombre") en la cabecera.');
    process.exit(1);
  }

  const env = createEnv();
  const prisma = createPrisma();
  await prisma.$connect();

  try {
    const embedder = createEmbedder(env);
    const businessId = await resolveBusinessId(prisma, flagString(flags, 'business'));
    const products = new ProductRepository(prisma);

    let created = 0;
    let updated = 0;
    let failures = 0;
    const touched = new Set<string>();

    console.log(`Business: ${businessId}`);
    console.log(`Archivo:  ${absolute} (${rows.length - 1} filas)`);
    console.log('');

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index];
      const name = cell(row, columns.name);
      const line = index + 1;

      if (!name) {
        console.error(`✗ línea ${line} — sin "name", se omite`);
        failures += 1;
        continue;
      }

      const priceRaw = cell(row, columns.price);
      const price = priceRaw ? parsePrice(priceRaw) : 0;

      if (price === null) {
        console.error(`✗ línea ${line} (${name}) — precio no válido: "${priceRaw}"`);
        failures += 1;
        continue;
      }

      const description = cell(row, columns.description) || null;
      const category = cell(row, columns.category) || null;
      const imageUrl = cell(row, columns.imageUrl) || null;
      const stock = parseInteger(cell(row, columns.stock), 0);

      if (dryRun) {
        console.log(`· ${name} — precio ${price}, stock ${stock}, categoría ${category ?? '—'}`);
        continue;
      }

      const existing = await prisma.product.findFirst({ where: { businessId, name } });

      const saved = existing
        ? await prisma.product.update({
            where: { id: existing.id },
            data: { description, price, stock, category, imageUrl, active: true },
          })
        : await prisma.product.create({
            data: { businessId, name, description, price, stock, category, imageUrl },
          });

      if (existing) updated += 1;
      else created += 1;

      const [vector] = await embedder.embed([productEmbeddingText(saved)]);
      await products.saveEmbedding(saved.id, vector);
      touched.add(saved.id);

      console.log(`✓ ${name} — ${existing ? 'actualizado' : 'creado'} y vectorizado`);
    }

    if (dryRun) {
      console.log('');
      console.log('Dry run: no se escribió nada.');
      return;
    }

    // Re-vectoriza el resto del catálogo activo: cubre los productos que ya
    // existían y no venían en el CSV (si no, quedarían sin embedding). Los del
    // CSV se saltan porque ya se vectorizaron arriba.
    let backfilled = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await products.findByBusiness(businessId, { limit: PAGE_SIZE, offset });
      for (const product of page) {
        if (touched.has(product.id)) continue;
        const [vector] = await embedder.embed([productEmbeddingText(product)]);
        await products.saveEmbedding(product.id, vector);
        backfilled += 1;
      }
      if (page.length < PAGE_SIZE) break;
    }

    const invalidated = await createSemanticCache(prisma, embedder, env).invalidate(businessId);

    console.log('');
    console.log(`Listo: ${created} creado(s), ${updated} actualizado(s).`);
    console.log(
      `Catálogo re-vectorizado: ${backfilled} producto(s). ` +
        `Caché semántica invalidada (${invalidated} entradas).`,
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
