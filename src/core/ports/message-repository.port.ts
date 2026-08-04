export interface MessageData {
  id: string;
  conversationId: string;
  role: string;
  content: unknown;
  tokenUsage?: unknown;
  createdAt: Date;
}

export interface InboundActivityItem {
  id: string;
  conversationId: string;
  customerIdentifier: string;
  customerName: string | null;
  createdAt: Date;
  content: unknown;
}

export interface MessageRepositoryPort {
  save(data: {
    conversationId: string;
    /** Denormalizado para consultas tenant-scoped de analytics sin JOIN. */
    businessId: string;
    role: string;
    content: unknown;
    tokenUsage?: unknown;
    /** InboundMessage origen (USER entrante) — hace el save idempotente. */
    inboundMessageId?: string;
  }): Promise<MessageData & { created: boolean }>;
  findRecent(conversationId: string, limit?: number): Promise<MessageData[]>;
  /** Mensajes USER entrantes recientes (notificaciones de escritura del dashboard). */
  findInboundActivity(
    businessId: string | undefined,
    since: Date,
    limit: number,
  ): Promise<InboundActivityItem[]>;
}
