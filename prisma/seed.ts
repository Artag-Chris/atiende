import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createCipheriv, randomBytes } from 'crypto';

/**
 * Seed unificado de Atiende (dev/staging).
 *
 * Reemplaza a seed-lumenx.sql + seed-catalog-lumenx.sql + la parte de usuarios
 * del seed.ts original. Es IDEMPOTENTE: se puede correr N veces sin duplicar.
 *
 * Crea:
 *   1. Business LumenX Labs (upsert por whatsapp_phone_id).
 *   2. Cuentas de canal (WhatsApp + Instagram + Messenger) con token CIFRADO
 *      AES-256-GCM (ENCRYPTION_MASTER_KEY). Los tokens se leen del .env
 *      (META_DEV_*), como en dev single-tenant.
 *   3. Catálogo: 6 servicios (LumenX) + 20 productos tech.
 *   4. Usuarios admin (ADMIN + SUPER_ADMIN) con bcrypt.
 *
 * Uso: npm run prisma:seed
 * Requiere .env con DATABASE_URL + ENCRYPTION_MASTER_KEY + META_DEV_*.
 */

const prisma = new PrismaClient();

const BUSINESS_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const WHATSAPP_ACCOUNT_ID = '1161637943695191';

function encrypt(plaintext: string, masterKeyBase64: string): string {
  const key = Buffer.from(masterKeyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

async function seedBusinessAndAccounts() {
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterKey || Buffer.from(masterKey, 'base64').length !== 32) {
    console.error(
      'ENCRYPTION_MASTER_KEY requerida (32 bytes base64). Ej: crypto.randomBytes(32).toString("base64")',
    );
    process.exit(1);
  }

  const business = await prisma.business.upsert({
    where: { whatsappPhoneId: WHATSAPP_ACCOUNT_ID },
    update: {},
    create: {
      id: BUSINESS_ID,
      name: 'LumenX Labs',
      whatsappPhoneId: WHATSAPP_ACCOUNT_ID,
      whatsappTokenEncrypted: encrypt(
        process.env.META_DEV_ACCESS_TOKEN ?? '',
        masterKey,
      ),
      systemPromptExtras: `SOBRE LUMENX LABS:
LumenX Labs es una empresa de desarrollo y automatización de software, diseño de páginas web premium y soluciones digitales a medida. Fundada por Christian Henao, un desarrollador con 5+ años de experiencia en múltiples campos.

SERVICIOS:
- Desarrollo de software a medida (web, móvil, APIs)
- Automatización de procesos y flujos de trabajo
- Diseño y desarrollo de páginas web premium
- Integración con APIs externas (WhatsApp, pagos, CRM)
- Chatbots e inteligencia artificial para negocios
- Consultoría tecnológica

IDIOMAS:
- Español (principal)
- Inglés

CONTACTO:
- Web: lumenxlabs.com.co
- Líder: Christian Henao

ESTILO DE RESPUESTA:
- Sé profesional pero cercano.
- Habla de los servicios con confianza.
- Si el cliente quiere un presupuesto, pide detalles del proyecto y indica que el equipo lo contactará pronto.
- Menciona que LumenX Labs trabaja con tecnologías modernas (React, Next.js, NestJS, Python, IA).
- Si el cliente pregunta por precios, indica que cada proyecto es personalizado y se cotiza según los requerimientos.`,
      settings: {
        language: 'auto',
        business_hours: 'Lun-Vie 9:00-18:00',
        location: 'Colombia',
        website: 'https://lumenxlabs.com.co',
      },
    },
  });

  const channels: Array<{
    channel: 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER';
    accountId?: string;
    token?: string;
    isPrimary: boolean;
  }> = [
    {
      channel: 'WHATSAPP',
      accountId: process.env.META_DEV_PHONE_NUMBER_ID,
      token: process.env.META_DEV_ACCESS_TOKEN,
      isPrimary: true,
    },
    {
      channel: 'INSTAGRAM',
      accountId: process.env.META_DEV_IG_ID,
      token: process.env.META_DEV_IG_TOKEN,
      isPrimary: true,
    },
    {
      channel: 'MESSENGER',
      accountId: process.env.META_DEV_PAGE_ID,
      token: process.env.META_MESSENGER_PAGE_TOKEN ?? process.env.META_DEV_PAGE_TOKEN,
      isPrimary: true,
    },
  ];

  for (const c of channels) {
    if (!c.accountId || !c.token) {
      console.warn(`  [skip] ${c.channel}: falta META_DEV_* (accountId=${c.accountId || '—'})`);
      continue;
    }
    await prisma.channelAccount.upsert({
      where: { channel_accountId: { channel: c.channel, accountId: c.accountId } },
      update: {
        businessId: business.id,
        tokenEncrypted: encrypt(c.token, masterKey),
        isPrimary: c.isPrimary,
      },
      create: {
        businessId: business.id,
        channel: c.channel,
        accountId: c.accountId,
        tokenEncrypted: encrypt(c.token, masterKey),
        isPrimary: c.isPrimary,
      },
    });
    console.log(`  [ok] channel_account ${c.channel} (${c.accountId})`);
  }

  return business;
}

async function seedCatalog(businessId: string) {
  const services: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    price: number;
    stock: number;
  }> = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      name: 'Desarrollo Web Premium',
      description:
        'Sitios web modernos con React, Next.js y diseños premium. Incluye responsive design, SEO y rendimiento optimizado.',
      category: 'Desarrollo',
      price: 0,
      stock: 999,
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      name: 'Aplicaciones Móviles',
      description:
        'Apps nativas e híbridas para iOS y Android con React Native o Flutter.',
      category: 'Desarrollo',
      price: 0,
      stock: 999,
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'Automatización de Procesos',
      description:
        'Automatización de flujos de trabajo con integraciones API, bots y herramientas inteligentes.',
      category: 'Automatización',
      price: 0,
      stock: 999,
    },
    {
      id: '10000000-0000-0000-0000-000000000004',
      name: 'Chatbots con IA',
      description:
        'Asistentes virtuales inteligentes para WhatsApp, web y redes sociales. Potenciados con IA generativa.',
      category: 'IA',
      price: 0,
      stock: 999,
    },
    {
      id: '10000000-0000-0000-0000-000000000005',
      name: 'Consultoría Tecnológica',
      description:
        'Asesoría personalizada para elegir la mejor stack tecnológica y estrategia digital para tu negocio.',
      category: 'Consultoría',
      price: 0,
      stock: 999,
    },
    {
      id: '10000000-0000-0000-0000-000000000006',
      name: 'Integración WhatsApp Business API',
      description:
        'Conecta tu negocio con WhatsApp Business API para atención automatizada y escalable.',
      category: 'Integraciones',
      price: 0,
      stock: 999,
    },
  ];

  const products: Array<{
    name: string;
    description: string;
    price: number;
    stock: number;
    category: string;
  }> = [
    { name: 'MacBook Pro 14 M3', description: 'Laptop Apple con chip M3, 18GB RAM, 512GB SSD. Perfecta para desarrollo y diseño.', price: 1999.0, stock: 15, category: 'Laptops' },
    { name: 'Dell XPS 15', description: 'Laptop Dell con Intel i7-13700H, 16GB RAM, 512GB SSD, pantalla OLED 3.5K.', price: 1599.0, stock: 10, category: 'Laptops' },
    { name: 'ThinkPad X1 Carbon', description: 'Laptop Lenovo ultraligera, Intel i7, 16GB RAM, 1TB SSD, ideal para ejecutivos.', price: 1849.0, stock: 8, category: 'Laptops' },
    { name: 'HP Spectre x360', description: 'Laptop convertible 2-en-1, Intel i7, 16GB RAM, pantalla táctil 14 pulgadas.', price: 1449.0, stock: 12, category: 'Laptops' },
    { name: 'iPhone 15 Pro', description: 'Smartphone Apple con chip A17 Pro, 256GB, cámara de 48MP, titanio.', price: 1199.0, stock: 25, category: 'Smartphones' },
    { name: 'Samsung Galaxy S24 Ultra', description: 'Smartphone Samsung con S Pen, 256GB, cámara de 200MP, pantalla AMOLED 6.8".', price: 1299.0, stock: 20, category: 'Smartphones' },
    { name: 'Google Pixel 8 Pro', description: 'Smartphone Google con chip Tensor G3, 128GB, cámara con IA, 7 años de actualizaciones.', price: 999.0, stock: 18, category: 'Smartphones' },
    { name: 'AirPods Pro 2', description: 'Auriculares inalámbricos Apple con cancelación de ruido activa y audio espacial.', price: 249.0, stock: 40, category: 'Accesorios' },
    { name: 'Samsung Galaxy Buds2 Pro', description: 'Auriculares inalámbricos Samsung con ANC, sonido Hi-Fi 24bit, IPX7.', price: 179.0, stock: 35, category: 'Accesorios' },
    { name: 'Logitech MX Master 3S', description: 'Mouse inalámbrico ergonómico con scroll magnético, silencioso, USB-C.', price: 99.0, stock: 50, category: 'Accesorios' },
    { name: 'Keychron K3 Pro', description: 'Teclado mecánico inalámbrico slim, switches Low Profile, RGB, Bluetooth.', price: 119.0, stock: 30, category: 'Accesorios' },
    { name: 'LG UltraFine 27UK850', description: 'Monitor 4K 27 pulgadas, HDR10, USB-C 60W, AMD FreeSync, 99% sRGB.', price: 549.0, stock: 14, category: 'Monitores' },
    { name: 'Dell UltraSharp U2723QE', description: 'Monitor 4K 27", IPS Black, USB-C 90W Hub, VESA DisplayHDR 400.', price: 619.0, stock: 10, category: 'Monitores' },
    { name: 'Samsung T7 Portable SSD 1TB', description: 'SSD portátil USB 3.2, lectura 1050MB/s, compacto y resistente.', price: 109.0, stock: 45, category: 'Almacenamiento' },
    { name: 'WD Black SN850X 2TB', description: 'SSD NVMe PCIe Gen4, lectura 7300MB/s, ideal para gaming y edición.', price: 189.0, stock: 22, category: 'Almacenamiento' },
    { name: 'Ubiquiti UniFi Dream Router', description: 'Router WiFi 6E, Mesh, 4x4 MIMO, integración UniFi, gestión centralizada.', price: 349.0, stock: 8, category: 'Networking' },
    { name: 'TP-Link Deco XE75', description: 'Sistema Mesh WiFi 6E, tri-band, cobertura hasta 550m², pack de 3.', price: 299.0, stock: 12, category: 'Networking' },
    { name: 'Sony WH-1000XM5', description: 'Auriculares over-ear ANC líder, 30h batería, LDAC, multipoint.', price: 349.0, stock: 16, category: 'Audio' },
    { name: 'JBL Charge 5', description: 'Bocina portátil resistente al agua IP67, 20h batería, powerbank.', price: 179.0, stock: 28, category: 'Audio' },
    { name: 'Anker Nano II 65W', description: 'Cargador GaN USB-C compacto, carga rápida para laptops y smartphones.', price: 45.0, stock: 60, category: 'Cables y Cargadores' },
  ];

  const serviceCatalog = services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    price: s.price,
    stock: s.stock,
    category: s.category,
  }));
  const productCatalog = products.map((p, i) => ({
    id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    name: p.name,
    description: p.description,
    price: p.price,
    stock: p.stock,
    category: p.category,
  }));
  const catalog = [...serviceCatalog, ...productCatalog];

  let count = 0;
  for (const p of catalog) {
    const existing = await prisma.product.findUnique({ where: { id: p.id } });
    if (!existing) {
      await prisma.product.create({
        data: {
          id: p.id,
          businessId,
          name: p.name,
          description: p.description,
          price: p.price,
          stock: p.stock,
          category: p.category,
          active: true,
        },
      });
      count += 1;
    }
  }
  console.log(`  [ok] catálogo: ${count} productos nuevos (${catalog.length} total)`);
}

async function seedUsers(businessId: string) {
  const admins = [
    {
      email: process.env.SEED_ADMIN_EMAIL || 'admin@atiende.dev',
      password: process.env.SEED_ADMIN_PASSWORD || 'admin123',
      name: 'Admin',
      role: 'ADMIN' as const,
    },
    {
      email: process.env.SEED_CHRISTIAN_EMAIL || 'christian@atiende.dev',
      password: process.env.SEED_CHRISTIAN_PASSWORD || 'vakaloka88!',
      name: 'Christian',
      role: 'SUPER_ADMIN' as const,
    },
  ];

  for (const a of admins) {
    const existing = await prisma.businessUser.findUnique({ where: { email: a.email } });
    if (!existing) {
      await prisma.businessUser.create({
        data: {
          businessId,
          email: a.email,
          name: a.name,
          password: await bcrypt.hash(a.password, 10),
          role: a.role,
        },
      });
      console.log(`  [ok] usuario ${a.email} (${a.role})`);
    }
  }
}

async function seedPricing() {
  // Tasa inicial USD→COP (el cron diario la mantiene actualizada).
  await prisma.exchangeRate.upsert({
    where: { pair: 'USD_COP' },
    update: {},
    create: { pair: 'USD_COP', rate: Number(process.env.USD_TO_COP_RATE ?? 4000), source: 'seed' },
  });

  // Costos de infraestructura cloud (precios de referencia en USD/mes; el cron
  // semanal o un seed posterior los actualiza). La latencia aprox va en metadata.
  const cloudPrices: Array<{
    provider: string;
    service: string;
    region: string;
    priceUsd: number;
    unit: string;
    metadata: Prisma.InputJsonValue;
    source: string;
  }> = [
    { provider: 'neon', service: 'postgres', region: 'global', priceUsd: 19, unit: 'month', metadata: { freeTier: true }, source: 'seed' },
    { provider: 'aws_rds', service: 'rds', region: 'sa-east-1', priceUsd: 60, unit: 'month', metadata: { latencyMs: 30 }, source: 'seed' },
    { provider: 'aws_rds', service: 'rds', region: 'us-east-1', priceUsd: 45, unit: 'month', metadata: { latencyMs: 80 }, source: 'seed' },
    { provider: 'vercel', service: 'hosting', region: 'global', priceUsd: 20, unit: 'month', metadata: { freeTier: true }, source: 'seed' },
    { provider: 'render', service: 'hosting', region: 'global', priceUsd: 7, unit: 'month', metadata: { freeTier: true }, source: 'seed' },
    { provider: 'aws', service: 'hosting', region: 'sa-east-1', priceUsd: 25, unit: 'month', metadata: {}, source: 'seed' },
  ];

  for (const p of cloudPrices) {
    await prisma.cloudPricing.upsert({
      where: { provider_service_region: { provider: p.provider, service: p.service, region: p.region } },
      update: {},
      create: {
        provider: p.provider,
        service: p.service,
        region: p.region,
        priceUsd: p.priceUsd,
        unit: p.unit,
        metadata: p.metadata,
        source: p.source,
      },
    });
  }
  console.log(`  [ok] pricing: ${cloudPrices.length} costos cloud + tasa USD_COP`);
}

async function main() {
  console.log('Seeding Atiende (unificado)...');
  const business = await seedBusinessAndAccounts();
  await seedCatalog(business.id);
  await seedUsers(business.id);
  await seedPricing();
  console.log('Seed completo ✅');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
