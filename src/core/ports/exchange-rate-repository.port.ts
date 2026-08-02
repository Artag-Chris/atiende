/** Tasa de cambio guardada en DB (ej. USD_COP). */
export interface ExchangeRateData {
  id: string;
  pair: string;
  rate: number;
  source: string;
  fetchedAt: Date;
}

export interface ExchangeRateRepositoryPort {
  /** Upsert por `pair`. Devuelve la fila resultante. */
  upsert(pair: string, rate: number, source: string): Promise<ExchangeRateData>;
  /** Lee la tasa vigente de un par. Null si no hay registro. */
  findByPair(pair: string): Promise<ExchangeRateData | null>;
}
