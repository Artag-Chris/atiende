export interface InboundMessageData {
  id: string;
  businessId: string;
  externalMessageId: string;
  receivedAt: Date;
  processedAt?: Date | null;
}

export interface InboundMessageRepositoryPort {
  save(data: {
    businessId: string;
    rawPayload: Record<string, unknown>;
    externalMessageId: string;
  }): Promise<InboundMessageData>;
  findByExternalId(
    businessId: string,
    externalMessageId: string,
  ): Promise<InboundMessageData | null>;
  markProcessed(id: string): Promise<void>;
}
