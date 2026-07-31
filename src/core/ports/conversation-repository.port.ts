import type { Channel } from '@prisma/client';

export interface ConversationData {
  id: string;
  businessId: string;
  channel: Channel;
  customerIdentifier: string;
  status: string;
}

export interface ConversationRepositoryPort {
  getOrCreate(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
  ): Promise<ConversationData>;
  findById(id: string): Promise<ConversationData | null>;
  /** Actualiza lastMessageAt (respuesta humana saliente desde el dashboard). */
  touchLastMessage(id: string): Promise<void>;
  updateStatus(
    id: string,
    status: 'ACTIVE' | 'ESCALATED' | 'RESOLVED' | 'ABANDONED',
    extra?: { escalationReason?: string; urgency?: string },
  ): Promise<void>;
  findEscalated(
    businessId?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ConversationData[]>;
  /**
   * Cierra escalaciones inactivas: status ESCALATED con lastMessageAt anterior
   * al cutoff pasan a ACTIVE. Devuelve cuántas actualizó.
   */
  expireEscalated(cutoff: Date): Promise<number>;
}
