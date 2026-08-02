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
 * Product.price (USD) y se actualizan por seed. El input del agente usa slugs.
 */
const SERVICE_SLUG_TO_CATEGORY: Record<string, string> = {
  process_automation: 'Automatización',
  ai_for_business: 'IA',
  web_development: 'Desarrollo',
  digital_transformation: 'Consultoría',
  ai_colombia: 'IA',
  cloud_deployment: 'Integraciones',
};

const InputSchema = z.object({
  services: z.array(z.string().min(1)).min(1),
  infrastructure: z
    .object({
      database: z.enum(['neon', 'aws_rds', 'none']).default('none'),
      hosting: z.enum(['vercel', 'render', 'aws', 'self_hosted', 'none']).default('none'),
      region: z.string().optional(),
    })
    .default({}),
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
        'Calcula una estimación de precio para servicios de LumenX Labs (desarrollo web, agente IA, automatización, transformación digital, cloud deployment) más infraestructura cloud opcional (base de datos Neon o AWS RDS, hosting Vercel/Render/AWS). Devuelve el total (USD o COP según el idioma) y persiste la cotización para que el cliente pueda consultarla después. Úsala cuando el cliente pida precios, presupuestos o cotizaciones.',
      inputSchema: {
        type: 'object',
        properties: {
          services: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Slugs de servicios LumenX: process_automation, ai_for_business, web_development, digital_transformation, ai_colombia, cloud_deployment',
          },
          infrastructure: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: ['neon', 'aws_rds', 'none'] },
              hosting: { type: 'string', enum: ['vercel', 'render', 'aws', 'self_hosted', 'none'] },
              region: { type: 'string' },
            },
          },
          currency: {
            type: 'string',
            enum: ['USD', 'COP'],
            description: 'Auto: USD en inglés, COP en español',
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
        output: `Invalid input: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
        isError: true,
      };
    }
    const { services, infrastructure, currency } = parsed.data;

    try {
      // 1. Servicios LumenX → Product por categoría.
      const serviceItems: Array<{ slug: string; name: string; priceUsd: number }> = [];
      for (const slug of services) {
        const category = SERVICE_SLUG_TO_CATEGORY[slug];
        if (!category) {
          return {
            output: `Servicio desconocido: ${slug}. Válidos: ${Object.keys(SERVICE_SLUG_TO_CATEGORY).join(', ')}`,
            isError: true,
          };
        }
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

      // 2. Infraestructura cloud → CloudPricing (por proveedor/servicio/región).
      const infraProviders: Array<{
        provider: string;
        service: string;
        priceUsd: number;
        unit: string;
        latencyMs: number | null;
      }> = [];
      const region = infrastructure.region ?? 'global';
      if (infrastructure.database !== 'none') {
        const dbProvider = infrastructure.database;
        const dbService = dbProvider === 'neon' ? 'postgres' : 'rds';
        const price = await this.cloudPricingRepo.findByProviderService(
          dbProvider,
          dbService,
          region,
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
      if (infrastructure.hosting !== 'none') {
        const hostingPrice = await this.cloudPricingRepo.findByProviderService(
          infrastructure.hosting,
          'hosting',
          region,
        );
        if (hostingPrice) {
          infraProviders.push({
            provider: infrastructure.hosting,
            service: 'hosting',
            priceUsd: hostingPrice.priceUsd,
            unit: hostingPrice.unit,
            latencyMs: (hostingPrice.metadata.latencyMs as number | undefined) ?? null,
          });
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
      const dedupKey = this.buildDedupKey(ctx, services, infrastructure, currency);
      const quote = await this.quoteRepo.save({
        businessId: ctx.businessId,
        conversationId: ctx.conversationId,
        customerIdentifier: ctx.customerPhone,
        channel: ctx.channel,
        services: serviceItems as unknown as Array<Record<string, unknown>>,
        infrastructure: { ...infrastructure, providers: infraProviders } as Record<string, unknown>,
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

  /** Hash canónico: ordena los servicios e infra para que el orden no duplique. */
  private buildDedupKey(
    ctx: TurnContext,
    services: string[],
    infra: { database: string; hosting: string; region?: string },
    currency?: 'USD' | 'COP',
  ): string {
    const canonical = JSON.stringify({
      channel: ctx.channel,
      customer: ctx.customerPhone,
      conversation: ctx.conversationId,
      services: [...services].sort(),
      infrastructure: { ...infra, region: infra.region ?? 'global' },
      currency: currency ?? 'COP',
    });
    return createHash('sha256').update(canonical).digest('hex');
  }
}
