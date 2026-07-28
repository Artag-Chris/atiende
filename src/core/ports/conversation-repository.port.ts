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
}
