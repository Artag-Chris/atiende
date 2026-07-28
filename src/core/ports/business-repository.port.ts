export interface BusinessData {
  id: string;
  name: string;
  whatsappPhoneId: string;
  systemPromptExtras?: string;
  settings: Record<string, unknown>;
}

export interface BusinessRepositoryPort {
  findByPhoneId(phoneId: string): Promise<BusinessData | null>;
  findById(id: string): Promise<BusinessData | null>;
}
