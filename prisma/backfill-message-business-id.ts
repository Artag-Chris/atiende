/**
 * Backfill idempotente de messages.business_id (denormalizado para analytics).
 *
 * La columna es NOT NULL sin default en el schema, así que `prisma db push`
 * no puede agregarla si la tabla messages ya tiene filas (error: "Added the
 * required column ... without a default value"). Este script:
 *
 *   1. Agrega la columna business_id (uuid, nullable) si no existe.
 *   2. La rellena desde conversations.business_id (mismo business de la conversación).
 *   3. Verifica que no queden mensajes sin business (huérfanos) y aborta si los hay.
 *   4. Fija NOT NULL.
 *   5. Crea el índice (business_id, role, created_at) si no existe.
 *
 * Es IDEMPOTENTE: puede ejecutarse varias veces sin error ni pérdida de datos.
 * Después de correrlo, `npx prisma db push` queda "in sync" y NO toca los datos.
 *
 * Uso:
 *   npx tsx prisma/backfill-message-business-id.ts
 *   (o: npm run prisma:backfill:messages)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const summary = await prisma.$transaction(async (tx) => {
    // 1. Columna nullable si no existe.
    await tx.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'messages' AND column_name = 'business_id'
        ) THEN
          ALTER TABLE messages ADD COLUMN business_id uuid;
        END IF;
      END $$;
    `);

    // 2. Backfill desde conversations (fuente de verdad del tenant).
    const updated = await tx.$executeRawUnsafe(`
      UPDATE messages m
      SET business_id = c.business_id
      FROM conversations c
      WHERE m.conversation_id = c.id
        AND m.business_id IS NULL
    `);

    // 3. Huérfanos (conversation borrada sin cascade — no debería ocurrir).
    const orphans = await tx.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM messages WHERE business_id IS NULL`,
    );
    const orphanCount = orphans[0]?.count ?? 0;
    if (orphanCount > 0) {
      throw new Error(
        `${orphanCount} mensaje(s) sin business_id (conversación huérfana). ` +
          `Revisa la data antes de aplicar NOT NULL.`,
      );
    }

    // 4. NOT NULL.
    await tx.$executeRawUnsafe(
      `ALTER TABLE messages ALTER COLUMN business_id SET NOT NULL`,
    );

    // 5. Índice (mismo nombre que genera Prisma desde @@index).
    await tx.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS messages_business_id_role_created_at_idx
      ON messages (business_id, role, created_at)
    `);

    return { updated, orphanCount };
  });

  const totals = await prisma.$queryRawUnsafe<Array<{ total: number; with_biz: number }>>(
    `SELECT COUNT(*)::int AS total, COUNT(business_id)::int AS with_biz FROM messages`,
  );
  const { total, with_biz } = totals[0] ?? { total: 0, with_biz: 0 };

  console.log(
    `OK: ${with_biz}/${total} mensajes con business_id (${summary.updated} backfilleados, ` +
      `${summary.orphanCount} huérfanos). Columna NOT NULL e índice listos.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
