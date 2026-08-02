/**
 * Seed de channel_accounts para un business (Fase 1: Instagram/Messenger/WhatsApp).
 *
 * Cifra el token con ENCRYPTION_MASTER_KEY (AES-256-GCM, formato iv:tag:ciphertext,
 * igual que CryptoService de la app) y hace upsert en channel_accounts.
 *
 * Uso:
 *   npx tsx prisma/seed-channel-accounts.ts <channel> <accountId> <token> [businessId] [--primary]
 *
 * Ejemplos:
 *   npx tsx prisma/seed-channel-accounts.ts instagram 17841400123456789 IGAA-xxx --primary
 *   npx tsx prisma/seed-channel-accounts.ts messenger 10987654321 EAAG-yyy
 *
 * Nota: Instagram envía por graph.instagram.com con un IG Access Token (IGAA...),
 * NO por la Messenger Platform. Messenger usa el Page Access Token (EAAG...).
 *
 * Si businessId se omite, se usa el primer business de la tabla.
 * `--primary` marca la cuenta como primaria (única por canal del business).
 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, randomBytes } from 'crypto';

const prisma = new PrismaClient();

const VALID_CHANNELS = new Set(['whatsapp', 'instagram', 'messenger']);

function encrypt(plaintext: string, masterKeyBase64: string): string {
  const key = Buffer.from(masterKeyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

async function main() {
  const [channelRaw, accountId, token, businessIdArg, primaryFlag] = process.argv.slice(2);
  const isPrimary = primaryFlag === '--primary';

  if (!channelRaw || !accountId || !token) {
    console.error(
      'Uso: npx tsx prisma/seed-channel-accounts.ts <channel> <accountId> <token> [businessId] [--primary]',
    );
    process.exit(1);
  }
  if (!VALID_CHANNELS.has(channelRaw)) {
    console.error(`Canal inválido: ${channelRaw}. Válidos: ${[...VALID_CHANNELS].join(', ')}`);
    process.exit(1);
  }

  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterKey || Buffer.from(masterKey, 'base64').length !== 32) {
    console.error(
      'ENCRYPTION_MASTER_KEY requerida (32 bytes base64). Ej: crypto.randomBytes(32).toString("base64")',
    );
    process.exit(1);
  }

  const channel = channelRaw.toUpperCase();

  const business = businessIdArg
    ? await prisma.business.findUnique({ where: { id: businessIdArg } })
    : await prisma.business.findFirst();
  if (!business) {
    console.error('No se encontró el business. Pasa un businessId o crea uno primero.');
    process.exit(1);
  }

  const tokenEncrypted = encrypt(token, masterKey);

  if (isPrimary) {
    await prisma.channelAccount.updateMany({
      where: { businessId: business.id, channel: channel as never },
      data: { isPrimary: false },
    });
  }

  const row = await prisma.channelAccount.upsert({
    where: { channel_accountId: { channel: channel as never, accountId } },
    create: {
      businessId: business.id,
      channel: channel as never,
      accountId,
      tokenEncrypted,
      isPrimary,
    },
    update: {
      businessId: business.id,
      tokenEncrypted,
      isPrimary,
    },
  });

  console.log(
    `Channel account listo: channel=${channelRaw} accountId=${accountId} business=${business.id} isPrimary=${isPrimary} id=${row.id}`,
  );
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
