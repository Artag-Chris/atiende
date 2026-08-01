import type { Channel } from '../domain/types';

/**
 * Cuenta de mensajería de un business en un canal, con su token cifrado.
 * La credencial de envío se resuelve aquí (nunca se expone en claro).
 */
export interface ChannelAccountData {
  id: string;
  businessId: string;
  channel: Channel;
  /** ID de la cuenta en el canal (phone_number_id, IG_ID, PAGE_ID). */
  accountId: string;
  /** Token cifrado AES-256-GCM (ENCRYPTION_MASTER_KEY). */
  tokenEncrypted: string;
  isPrimary: boolean;
}

export interface ChannelAccountRepositoryPort {
  /**
   * Resuelve la cuenta del business en el canal para ENVIAR.
   * Devuelve la marcada como primary si existe; si no, cualquiera del business.
   */
  findForBusiness(channel: Channel, businessId: string): Promise<ChannelAccountData | null>;
}
