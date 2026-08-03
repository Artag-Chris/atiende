import type { Channel } from '../domain/types';

/** Input para agendar una llamada/videollamada (tool schedule_call). */
export interface CallSchedulerInput {
  businessId: string;
  conversationId: string;
  customerIdentifier: string;
  channel: Channel;
  preferredTime: string;
  customerEmail?: string;
  notes?: string;
  quoteId?: string;
}

export interface CallSchedulerResult {
  id: string;
  status: string;
}

/**
 * Port para agendar llamadas. Hoy hay un solo adapter (EmailCallScheduler) que
 * persiste el lead + notifica por email. A futuro, un adapter Cal.com puede
 * crear el evento real — el core y la tool no cambian.
 */
export interface CallSchedulerPort {
  /** Persiste la solicitud y notifica al equipo. Idempotente por dedupKey. */
  requestCall(input: CallSchedulerInput): Promise<CallSchedulerResult>;
}
