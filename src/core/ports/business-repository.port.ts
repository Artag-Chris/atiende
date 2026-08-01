import type { Channel } from '../domain/types';

export interface BusinessData {
  id: string;
  name: string;
  /** Legacy (WhatsApp). Deprecado: las cuentas viven en ChannelAccount. */
  whatsappPhoneId?: string;
  systemPromptExtras?: string;
  settings: Record<string, unknown>;
}

export interface BusinessRepositoryPort {
  /**
   * Resuelve el business desde el ID de cuenta del canal que aparece en el
   * webhook (phone_number_id, IG_ID, PAGE_ID). Consulta ChannelAccount y,
   * como fallback de transición, el whatsappPhoneId legacy.
   */
  findByChannelAccount(channel: Channel, accountId: string): Promise<BusinessData | null>;
  findById(id: string): Promise<BusinessData | null>;
}
