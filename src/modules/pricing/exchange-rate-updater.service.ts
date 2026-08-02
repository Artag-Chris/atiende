import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EXCHANGE_RATE_REPOSITORY_TOKEN } from '@core/tokens';
import type { ExchangeRateRepositoryPort } from '@core/ports/exchange-rate-repository.port';

const USD_COP_PAIR = 'USD_COP';

/**
 * Actualiza la tasa USD→COP en ExchangeRate (cron diario).
 * Fuente: open.er-api.com (API pública gratuita de tipo de cambio).
 * Si la API falla, se mantiene el valor anterior en DB y se loguea.
 */
@Injectable()
export class ExchangeRateUpdaterService {
  private readonly logger = new Logger(ExchangeRateUpdaterService.name);
  private readonly apiUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(EXCHANGE_RATE_REPOSITORY_TOKEN)
    private readonly repo: ExchangeRateRepositoryPort,
  ) {
    this.apiUrl =
      this.config.get<string>('EXCHANGE_RATE_API_URL') ?? 'https://open.er-api.com/v6/latest/USD';
  }

  async run(): Promise<{ pair: string; rate: number; source: string } | null> {
    try {
      const res = await fetch(this.apiUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
      const cop = data?.rates?.['COP'];
      if (!cop || typeof cop !== 'number') {
        throw new Error('No COP rate in response');
      }

      const source = this.apiUrl.includes('open.er-api.com') ? 'open.er-api.com' : 'api';
      const saved = await this.repo.upsert(USD_COP_PAIR, cop, source);
      this.logger.log(`Exchange rate updated: ${USD_COP_PAIR} = ${cop} (${source})`);
      return { pair: saved.pair, rate: saved.rate, source: saved.source };
    } catch (error) {
      this.logger.warn(`Exchange rate update failed (keeping previous value): ${error}`);
      return null;
    }
  }
}
