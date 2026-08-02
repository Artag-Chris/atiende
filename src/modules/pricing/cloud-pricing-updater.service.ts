import { Injectable, Logger } from '@nestjs/common';

/**
 * Actualiza los costos de infraestructura cloud en CloudPricing.
 *
 * v1 pragmático: aún no hay fuentes API estables de precios integradas
 * (Neon/AWS/Vercel no exponen pricing API pública simple). Los costos viven en
 * el seed manual (source='manual', fetchedAt = seed time). Este job corre
 * semanal (update-cloud-pricing) y, cuando se integre una fuente real
 * (fetch + upsert por proveedor), se agrega aquí sin tocar el resto.
 *
 * El job existe para que el schedule y el flujo de mantenimiento estén listos;
 * hoy no modifica nada y lo loguea.
 */
@Injectable()
export class CloudPricingUpdaterService {
  private readonly logger = new Logger(CloudPricingUpdaterService.name);

  async run(): Promise<{ updated: number; failed: string[] }> {
    this.logger.log(
      'Cloud pricing update: no automatic sources configured yet — keeping manual seed (source=manual)',
    );
    return { updated: 0, failed: [] };
  }
}
