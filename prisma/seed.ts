import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@atiende.dev';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';

  const business = await prisma.business.findFirst();
  if (!business) {
    console.warn('No business found — run migrations and add a business first');
    return;
  }

  const existing = await prisma.businessUser.findUnique({ where: { email } });
  if (!existing) {
    const hashed = await bcrypt.hash(password, 10);
    await prisma.businessUser.create({
      data: { businessId: business.id, email, name: 'Admin', password: hashed, role: 'ADMIN' },
    });
    console.log(`Seeded admin: ${email}`);
  }

  const christianEmail = process.env.SEED_CHRISTIAN_EMAIL || 'christian@atiende.dev';
  const christianPassword = process.env.SEED_CHRISTIAN_PASSWORD || 'vakaloka88!';
  const christianExisting = await prisma.businessUser.findUnique({ where: { email: christianEmail } });
  if (!christianExisting) {
    const hashed = await bcrypt.hash(christianPassword, 10);
    await prisma.businessUser.create({
      data: { businessId: business.id, email: christianEmail, name: 'Christian', password: hashed, role: 'SUPER_ADMIN' },
    });
    console.log(`Seeded christian: ${christianEmail}`);
  }
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
