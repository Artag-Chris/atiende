import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { z } from 'zod';
import type { ToolModulePort, ToolExecutionResult } from '@core/ports/tool-module.port';
import type { ToolDefinition, TurnContext } from '@core/domain/types';
import {
  CLOUD_PRICING_REPOSITORY_TOKEN,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  QUOTE_REPOSITORY_TOKEN,
} from '@core/tokens';
import type { CloudPricingRepositoryPort } from '@core/ports/cloud-pricing-repository.port';
import type { ExchangeRateRepositoryPort } from '@core/ports/exchange-rate-repository.port';
import type { QuoteRepositoryPort } from '@core/ports/quote-repository.port';
import { ProductRepository } from '@modules/persistence/postgres/product.repository';

/**
 * Servicios LumenX (slug → categoría en Product). Los precios viven en
 * Product.price (USD) y se actualizan por seed.
 */
const SERVICE_SLUG_TO_CATEGORY: Record<string, string> = {
  web_development: 'Desarrollo',
  ai_for_business: 'IA',
  process_automation: 'Automatización',
  digital_transformation: 'Consultoría',
  cloud_deployment: 'Integraciones',
};

/** Sinónimos (español/inglés) → slug de servicio. El agente escribe natural. */
const SERVICE_ALIASES: Record<string, string> = {
  // web development
  'desarrollo web': 'web_development',
  'pagina web': 'web_development',
  'página web': 'web_development',
  'sitio web': 'web_development',
  'sitio estatico': 'web_development',
  'sitio estático': 'web_development',
  'web estatica': 'web_development',
  'web estática': 'web_development',
  'landing page': 'web_development',
  web: 'web_development',
  website: 'web_development',
  'web development': 'web_development',
  'web design': 'web_development',
  ecommerce: 'web_development',
  'tienda online': 'web_development',
  // AI
  'agente de whatsapp': 'ai_for_business',
  'agente whatsapp': 'ai_for_business',
  chatbot: 'ai_for_business',
  'chat bot': 'ai_for_business',
  'inteligencia artificial': 'ai_for_business',
  'agente ia': 'ai_for_business',
  'bot de whatsapp': 'ai_for_business',
  ia: 'ai_for_business',
  ai: 'ai_for_business',
  'ai agent': 'ai_for_business',
  // automation
  automatizacion: 'process_automation',
  automatización: 'process_automation',
  'automatizacion de procesos': 'process_automation',
  'automatización de procesos': 'process_automation',
  automation: 'process_automation',
  'process automation': 'process_automation',
  // transformation
  'transformacion digital': 'digital_transformation',
  'transformación digital': 'digital_transformation',
  'digital transformation': 'digital_transformation',
  consultoria: 'digital_transformation',
  consultoría: 'digital_transformation',
  // cloud
  'cloud deployment': 'cloud_deployment',
  'deployment cloud': 'cloud_deployment',
  'subir a la nube': 'cloud_deployment',
  'servidor privado': 'cloud_deployment',
  hosting: 'cloud_deployment',
  'escalamiento cloud': 'cloud_deployment',
};

/** Sinónimos de proveedores de base de datos → provider usado en CloudPricing. */
const DATABASE_ALIASES: Record<string, string> = {
  neon: 'neon',
  'neon db': 'neon',
  postgresql: 'neon',
  postgres: 'neon',
  'aws rds': 'aws_rds',
  rds: 'aws_rds',
  'amazon rds': 'aws_rds',
  amazon: 'aws_rds',
  aws: 'aws_rds',
  'base de datos': 'neon',
  database: 'neon',
};

/** Sinónimos de proveedores de hosting → provider usado en CloudPricing. */
const HOSTING_ALIASES: Record<string, string> = {
  vercel: 'vercel',
  render: 'render',
  aws: 'aws',
  amazon: 'aws',
  'amazon web services': 'aws',
  'self hosted': 'self_hosted',
  'servidor propio': 'self_hosted',
  'propio servidor': 'self_hosted',
  'tu pc': 'self_hosted',
  'su pc': 'self_hosted',
  'pc del cliente': 'self_hosted',
};

/** Regiones: ciudad/país → región usada en CloudPricing. */
const REGION_ALIASES: Record<string, string> = {
  pereira: 'sa-east-1',
  colombia: 'sa-east-1',
  bogota: 'sa-east-1',
  bogotá: 'sa-east-1',
  medellin: 'sa-east-1',
  medellín: 'sa-east-1',
  'south america': 'sa-east-1',
  latam: 'sa-east-1',
  eeuu: 'us-east-1',
  usa: 'us-east-1',
  'united states': 'us-east-1',
  'us-east': 'us-east-1',
  norteamerica: 'us-east-1',
};

/** Normaliza el texto para resolver sinónimos (minúsculas, sin acentos). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Resuelve un término libre (servicio, proveedor, región) contra sus sinónimos. */
function resolve<T>(text: string, aliases: Record<string, T>, fallback: T | null): T | null {
  const key = normalize(text);
  if (aliases[key]) return aliases[key];
  // Coincidencia parcial: "quiero una pagina web" → web_development.
  for (const [alias, value] of Object.entries(aliases)) {
    const normAlias = normalize(alias);
    if (key.includes(normAlias) || normAlias.includes(key)) return value;
  }
  return fallback;
}

const InputSchema = z.object({
  /** Términos naturales en el idioma del cliente (ej: "desarrollo web", "chatbot"). */
  services: z.array(z.string().min(1)).min(1),
  /** Proveedores de infraestructura (opcional). Acepta nombres naturales. */
  database: z.string().optional(),
  hosting: z.string().optional(),
  region: z.string().optional(),
  currency: z.enum(['USD', 'COP']).optional(),
});

const USD_COP_PAIR = 'USD_COP';

@Injectable()
export class EstimatePriceTool implements ToolModulePort {
  readonly name = 'estimate_price';
  readonly mutatesState = true; // persiste la cotización en Quote
  private readonly logger = new Logger(EstimatePriceTool.name);

  constructor(
    private readonly config: ConfigService,
    private readonly productRepo: ProductRepository,
    @Inject(CLOUD_PRICING_REPOSITORY_TOKEN)
    private readonly cloudPricingRepo: CloudPricingRepositoryPort,
    @Inject(EXCHANGE_RATE_REPOSITORY_TOKEN)
    private readonly exchangeRateRepo: ExchangeRateRepositoryPort,
    @Inject(QUOTE_REPOSITORY_TOKEN)
    private readonly quoteRepo: QuoteRepositoryPort,
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Calcula una estimación de precio para servicios de LumenX Labs (desarrollo web, agente IA de WhatsApp, automatización, transformación digital, cloud deployment/servidores) más infraestructura cloud opcional (base de datos Neon o AWS RDS, hosting Vercel/Render/AWS). Recibe los servicios y proveedores en el idioma del cliente (ej. "desarrollo web", "chatbot", "Amazon", "Neon"). Devuelve el total en COP (español) o USD (inglés) y persiste la cotización. Úsala cuando el cliente pida precios, presupuestos o cotizaciones.',
      inputSchema: {
        type: 'object',
        properties: {
          services: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Servicios que el cliente pide, en su idioma (ej: ["desarrollo web"], ["agente de whatsapp"], ["automatizacion de procesos"]). Extrae esto del mensaje del cliente.',
          },
          database: {
            type: 'string',
            description:
              'Proveedor de base de datos mencionado (ej: "Neon", "AWS", "Amazon", "postgres"). Opcional.',
          },
          hosting: {
            type: 'string',
            description:
              'Proveedor de hosting mencionado (ej: "Vercel", "Render", "AWS", "servidor propio"). Opcional.',
          },
          region: {
            type: 'string',
            description:
              'Región/ciudad si el cliente la menciona (ej: "Pereira", "Colombia", "EEUU"). Opcional.',
          },
          currency: {
            type: 'string',
            enum: ['USD', 'COP'],
            description: 'Auto: USD si el cliente escribe en inglés, COP si en español',
          },
        },
        required: ['services'],
      },
    };
  }

  async execute(input: Record<string, unknown>, ctx: TurnContext): Promise<ToolExecutionResult> {
    const start = Date.now();

    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        output:
          'No pude interpretar la solicitud de cotización. Por favor pide los servicios que necesita (ej: desarrollo web, agente de WhatsApp, automatización).',
        isError: true,
      };
    }
    const { services, database, hosting, region, currency } = parsed.data;

    try {
      // 1. Resolver servicios: términos naturales → slugs → Product por categoría.
      const slugs = services
        .map((s) => resolve(s, SERVICE_ALIASES, null))
        .filter(Boolean) as string[];
      if (slugs.length === 0) {
        return {
          output:
            'No reconocí los servicios solicitados. Los servicios disponibles son: desarrollo web, agente IA de WhatsApp, automatización de procesos, transformación digital y cloud deployment. ¿Cuál te interesa?',
          isError: true,
        };
      }

      const serviceItems: Array<{ slug: string; name: string; priceUsd: number }> = [];
      for (const slug of slugs) {
        const category = SERVICE_SLUG_TO_CATEGORY[slug];
        const product = await this.productRepo.findByBusinessAndCategory(ctx.businessId, category);
        if (!product) {
          this.logger.warn(
            `Service not found for category ${category} (business ${ctx.businessId})`,
          );
          continue;
        }
        serviceItems.push({ slug, name: product.name, priceUsd: Number(product.price) });
      }
      if (serviceItems.length === 0) {
        return {
          output: 'No se encontraron precios para los servicios solicitados.',
          isError: true,
        };
      }

      // 2. Infraestructura: resolver proveedores naturales → CloudPricing.
      const infraProviders: Array<{
        provider: string;
        service: string;
        priceUsd: number;
        unit: string;
        latencyMs: number | null;
      }> = [];
      const resolvedRegion = region
        ? (resolve(region, REGION_ALIASES, null) ?? 'global')
        : 'global';

      if (database) {
        const dbProvider = resolve(database, DATABASE_ALIASES, null);
        if (dbProvider && dbProvider !== 'none') {
          const dbService = dbProvider === 'neon' ? 'postgres' : 'rds';
          const price = await this.cloudPricingRepo.findByProviderService(
            dbProvider,
            dbService,
            resolvedRegion,
          );
          if (price) {
            infraProviders.push({
              provider: dbProvider,
              service: dbService,
              priceUsd: price.priceUsd,
              unit: price.unit,
              latencyMs: (price.metadata.latencyMs as number | undefined) ?? null,
            });
          }
        }
      }

      if (hosting) {
        const hostingProvider = resolve(hosting, HOSTING_ALIASES, null);
        if (hostingProvider && hostingProvider !== 'self_hosted') {
          const price = await this.cloudPricingRepo.findByProviderService(
            hostingProvider,
            'hosting',
            resolvedRegion,
          );
          if (price) {
            infraProviders.push({
              provider: hostingProvider,
              service: 'hosting',
              priceUsd: price.priceUsd,
              unit: price.unit,
              latencyMs: (price.metadata.latencyMs as number | undefined) ?? null,
            });
          }
        }
      }

      // 3. Totales (en USD).
      const subtotalServices = serviceItems.reduce((acc, s) => acc + s.priceUsd, 0);
      const subtotalInfra = infraProviders.reduce((acc, p) => acc + p.priceUsd, 0);
      const totalUsd = subtotalServices + subtotalInfra;

      // 4. Moneda: USD (inglés) o COP (español, por defecto). Tasa desde
      // ExchangeRate (cron diario), fallback a env USD_TO_COP_RATE.
      const useCop = (currency ?? 'COP') === 'COP';
      let rateUsed: number | null = null;
      let totalDisplay: string;
      if (useCop) {
        const rate = await this.exchangeRateRepo.findByPair(USD_COP_PAIR);
        rateUsed = rate?.rate ?? this.config.get<number>('USD_TO_COP_RATE', 4000);
        const totalCop = Math.round(totalUsd * rateUsed);
        totalDisplay = `$${totalCop.toLocaleString('es-CO')} COP`;
      } else {
        totalDisplay = `$${totalUsd.toFixed(2)} USD`;
      }

      // 5. Persistir (idempotente por dedupKey canónico).
      const dedupKey = this.buildDedupKey(
        ctx,
        slugs,
        database ?? '',
        hosting ?? '',
        resolvedRegion,
        currency,
      );
      const quote = await this.quoteRepo.save({
        businessId: ctx.businessId,
        conversationId: ctx.conversationId,
        customerIdentifier: ctx.customerPhone,
        channel: ctx.channel,
        services: serviceItems as unknown as Array<Record<string, unknown>>,
        infrastructure: {
          database: database ?? undefined,
          hosting: hosting ?? undefined,
          region: resolvedRegion,
          providers: infraProviders,
        } as Record<string, unknown>,
        breakdown: {
          subtotalServices,
          subtotalInfra,
          totalUsd,
          latencyMs: infraProviders.map((p) => p.latencyMs).filter((l): l is number => l !== null),
        } as Record<string, unknown>,
        totalUsd: Math.round(totalUsd * 100) / 100,
        totalDisplay,
        currency: useCop ? 'COP' : 'USD',
        rateUsed: rateUsed ?? undefined,
        dedupKey,
      });

      const output = {
        quoteId: quote.id,
        total: totalDisplay,
        currency: quote.currency,
        services: serviceItems.map((s) => ({ name: s.name, priceUsd: s.priceUsd })),
        infrastructure: infraProviders.map((p) => ({
          provider: p.provider,
          service: p.service,
          priceUsd: p.priceUsd,
          unit: p.unit,
          latencyMs: p.latencyMs,
        })),
        subtotalServices,
        subtotalInfra,
        totalUsd: Math.round(totalUsd * 100) / 100,
      };

      return {
        output: JSON.stringify(output, null, 2),
        meta: { latencyMs: Date.now() - start },
      };
    } catch (error) {
      this.logger.error(`estimate_price failed: ${error}`);
      return { output: 'Error al calcular la cotización.', isError: true };
    }
  }

  /** Hash canónico: ordena los servicios para que el orden no duplique. */
  private buildDedupKey(
    ctx: TurnContext,
    services: string[],
    database: string,
    hosting: string,
    region: string,
    currency?: 'USD' | 'COP',
  ): string {
    const canonical = JSON.stringify({
      channel: ctx.channel,
      customer: ctx.customerPhone,
      conversation: ctx.conversationId,
      services: [...services].sort(),
      infrastructure: { database, hosting, region },
      currency: currency ?? 'COP',
    });
    return createHash('sha256').update(canonical).digest('hex');
  }
}
