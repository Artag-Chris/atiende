import type { Channel } from '../domain/types';

/** Datos de una solicitud de llamada persistida. */
export interface CallRequestData {
  id: string;
  businessId: string;
  conversationId: string;
  customerIdentifier: string;
  channel: Channel;
  preferredTime: string;
  customerEmail?: string | null;
  notes?: string | null;
  quoteId?: string | null;
  status: string;
  createdAt: Date;
}

/** Input para crear una solicitud de llamada. */
export interface CallRequestInput {
  businessId: string;
  conversationId: string;
  customerIdentifier: string;
  channel: Channel;
  preferredTime: string;
  customerEmail?: string;
  notes?: string;
  quoteId?: string;
  dedupKey: string;
}

export interface CallRequestRepositoryPort {
  /**
   * Persiste una solicitud de llamada. Si ya existe una con el mismo `dedupKey`
   * (idempotencia: reintento del job o doble llamada), devuelve la existente.
   */
  save(input: CallRequestInput): Promise<CallRequestData>;
  /** Última solicitud de un cliente en un canal (identidad por canal). */
  findLatestForCustomer(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<CallRequestData | null>;
}
