import type { Channel } from '@prisma/client';

export interface ConversationData {
  id: string;
  businessId: string;
  channel: Channel;
  customerIdentifier: string;
  status: string;
  customerName?: string | null;
  unreadCount?: number;
  lastMessageAt?: Date | null;
}

export interface ConversationRepositoryPort {
  getOrCreate(
    businessId: string,
    channel: Channel,
    customerIdentifier: string,
    customerName?: string,
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
   * Conversaciones con mensajes sin leer para el dashboard.
   * Excluye RESOLVED/ABANDONED.
   */
  findPending(
    businessId?: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ConversationData[]>;
  /** Incrementa el contador de no leídos (mensaje USER entrante). */
  incrementUnread(id: string): Promise<void>;
  /** Pone a cero el contador de no leídos (dashboard marcó leído). */
  resetUnread(id: string): Promise<void>;
  /**
   * Cierra escalaciones inactivas: status ESCALATED con lastMessageAt anterior
   * al cutoff pasan a ACTIVE. Devuelve cuántas actualizó.
   */
  expireEscalated(cutoff: Date): Promise<number>;
}
