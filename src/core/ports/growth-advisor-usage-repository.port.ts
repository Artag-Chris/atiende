export interface GrowthUsageRecordInput {
  businessId: string;
  model: string;
  llmProvider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface GrowthAdvisorUsageRepositoryPort {
  /** Persiste una llamada del asesor (base de auditoría y presupuesto). */
  record(input: GrowthUsageRecordInput): Promise<void>;
  /** Suma del costo en USD de un business en el día calendario dado. */
  sumForDay(businessId: string, day: Date): Promise<number>;
}
