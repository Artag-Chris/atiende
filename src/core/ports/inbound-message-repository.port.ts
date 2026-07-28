export interface InboundMessageData {
  id: string;
  businessId: string;
  externalMessageId: string;
  receivedAt: Date;
}

export interface InboundMessageRepositoryPort {
  save(data: {
    businessId: string;
    rawPayload: Record<string, unknown>;
    externalMessageId: string;
  }): Promise<InboundMessageData>;
  existsByExternalId(businessId: string, externalMessageId: string): Promise<boolean>;
}
