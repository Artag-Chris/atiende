import type { Channel } from '../domain/types';

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

export type ConversationStatus = 'ACTIVE' | 'ESCALATED' | 'RESOLVED' | 'ABANDONED';

/** Fila de la exploradora de chats: conversación + preview del último mensaje. */
export interface ConversationListItem extends ConversationData {
  lastMessageText: string | null;
  lastMessageRole: string | null;
}

export interface ConversationListFilter {
  statuses?: ConversationStatus[];
  channel?: Channel;
  /** Búsqueda libre sobre customerName / customerIdentifier (case-insensitive). */
  search?: string;
  limit?: number;
  offset?: number;
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
   * Lista TODAS las conversaciones del tenant (cualquier status) con filtros
   * opcionales, ordenadas por actividad reciente. Incluye `total` para paginar.
   */
  findAll(
    businessId?: string,
    filter?: ConversationListFilter,
  ): Promise<{ data: ConversationListItem[]; total: number }>;
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
