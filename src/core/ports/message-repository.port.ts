export interface MessageData {
  id: string;
  conversationId: string;
  role: string;
  content: unknown;
  tokenUsage?: unknown;
  createdAt: Date;
}

export interface MessageRepositoryPort {
  save(data: {
    conversationId: string;
    role: string;
    content: unknown;
    tokenUsage?: unknown;
  }): Promise<MessageData>;
  findRecent(conversationId: string, limit?: number): Promise<MessageData[]>;
}
