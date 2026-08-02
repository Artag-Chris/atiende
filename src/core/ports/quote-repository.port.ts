import type { Channel } from '../domain/types';

/** Datos de una cotización persistida. */
export interface QuoteData {
  id: string;
  businessId: string;
  conversationId: string;
  customerIdentifier: string;
  channel: Channel;
  services: Array<Record<string, unknown>>;
  infrastructure: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  totalUsd: number;
  totalDisplay: string;
  currency: string;
  rateUsed?: number | null;
  dedupKey: string;
  status: string;
  notes?: string | null;
  createdAt: Date;
}

/** Input para crear una cotización. */
export interface QuoteInput {
  businessId: string;
  conversationId: string;
  customerIdentifier: string;
  channel: Channel;
  services: Array<Record<string, unknown>>;
  infrastructure: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  totalUsd: number;
  totalDisplay: string;
  currency: string;
  rateUsed?: number;
  dedupKey: string;
}

export interface QuoteRepositoryPort {
  /**
   * Persiste una cotización. Si ya existe una con el mismo `dedupKey`
   * (idempotencia: reintento del job o doble llamada), devuelve la existente
   * sin duplicar.
   */
  save(input: QuoteInput): Promise<QuoteData>;
  /**
   * Última cotización de un cliente en un canal (identidad por canal).
   * Solo el mismo (businessId, channel, customerIdentifier) ve sus cotizaciones.
   */
  findLatestForCustomer(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<QuoteData | null>;
  /** Busca por ID validando pertenencia al cliente/canal (para get_quote). */
  findByIdForCustomer(
    id: string,
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<QuoteData | null>;
}
