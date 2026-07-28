export interface ToneConfig {
  warmth: number;
  formality: number;
  empathy: number;
  proactiveness: number;
  verbosity: number;
}

export interface ScopeCheckResult {
  allowed: boolean;
  rejectionMessage?: string;
}

export interface ResponsePolicyPort {
  checkScope(businessId: string, message: string, businessName?: string): Promise<ScopeCheckResult>;
  buildSystemPromptExtras(businessName?: string, tone?: ToneConfig): string;
  validateResponse(response: string, context: { message: string; businessName?: string }): {
    approved: boolean;
    modified?: string;
    reason?: string;
  };
}
