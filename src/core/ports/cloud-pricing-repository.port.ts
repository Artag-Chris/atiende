/** Fila de costo de infraestructura cloud (precio por proveedor/servicio/región). */
export interface CloudPricingData {
  id: string;
  provider: string;
  service: string;
  region: string;
  priceUsd: number;
  unit: string;
  metadata: Record<string, unknown>;
  source: string;
  fetchedAt: Date;
}

/** Input para crear/actualizar un costo cloud (usado por el cron). */
export interface CloudPricingInput {
  provider: string;
  service: string;
  region: string;
  priceUsd: number;
  unit: string;
  metadata?: Record<string, unknown>;
  source?: string;
}

export interface CloudPricingRepositoryPort {
  /** Upsert por (provider, service, region). Devuelve la fila resultante. */
  upsert(input: CloudPricingInput): Promise<CloudPricingData>;
  /** Busca el costo de un servicio en un proveedor (y región, o 'global'). */
  findByProviderService(
    provider: string,
    service: string,
    region?: string,
  ): Promise<CloudPricingData | null>;
  /** Lista los costos de un proveedor (para el desglose/comparación). */
  listByProvider(provider: string): Promise<CloudPricingData[]>;
}
