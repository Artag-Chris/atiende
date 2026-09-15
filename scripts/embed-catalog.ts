import type { Product } from '@prisma/client';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';
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
 * Vectoriza el catálogo de productos/servicios.
 *
 * Sin esto `product_embeddings` queda vacío y la tool `search_catalog` del
 * agente devuelve 0 resultados: los precios existen en `products` pero son
 * invisibles para la búsqueda semántica.
 *
 * Uso:
 *   npm run catalog:embed
 *   npm run catalog:embed -- --missing
 *   npm run catalog:embed -- --business 573001234567
 */

const PAGE_SIZE = 100;

const USAGE = `
Vectoriza el catálogo (products → product_embeddings).

  npm run catalog:embed [opciones]

Opciones:
  --business <id>   businessId o whatsappPhoneId (default: el primer business)
  --missing         Solo vectoriza los productos que aún no tienen embedding
  --help            Muestra esta ayuda
`;

async function main(): Promise<void> {
  loadDotEnv();
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help === true) {
    console.log(USAGE);
    return;
  }

  const onlyMissing = flags.missing === true;
  const env = createEnv();
  const prisma = createPrisma();
  await prisma.$connect();

  try {
    const embedder = createEmbedder(env);
    const businessId = await resolveBusinessId(prisma, flagString(flags, 'business'));
    const products = new ProductRepository(prisma);

    // findByBusiness limita a 50 por defecto: se pagina para no dejar productos fuera.
    const all: Product[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await products.findByBusiness(businessId, { limit: PAGE_SIZE, offset });
      all.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    let targets = all;
    if (onlyMissing) {
      const existing = await prisma.productEmbedding.findMany({ select: { productId: true } });
      const withEmbedding = new Set(existing.map((row) => row.productId));
      targets = all.filter((product) => !withEmbedding.has(product.id));
    }

    console.log(`Business: ${businessId}`);
    console.log(`Productos activos: ${all.length} · a vectorizar: ${targets.length}`);
    console.log('');

    let done = 0;
    for (const product of targets) {
      const [vector] = await embedder.embed([productEmbeddingText(product)]);
      await products.saveEmbedding(product.id, vector);
      done += 1;
      console.log(`✓ ${product.name}`);
    }

    const invalidated = await createSemanticCache(prisma, embedder, env).invalidate(businessId);

    console.log('');
    console.log(
      `Listo: ${done} producto(s) vectorizado(s). ` +
        `Caché semántica invalidada (${invalidated} entradas).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
