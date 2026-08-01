import { Inject, Injectable } from '@nestjs/common';
import { CIRCUIT_BREAKER_CONFIG_TOKEN } from '@core/tokens';
import type { CircuitBreakerConfig } from '@config/ai.config';

export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker por defecto del router de LLMs.
 *
 * Estados:
 *  - closed: pasa todo; cuenta fallos/éxitos en una ventana fija. Se abre si
 *    los fallos superan failureThreshold o la tasa de error supera
 *    errorRateThreshold dentro de windowMs.
 *  - open: rechaza llamadas (fail fast) durante openTimeoutMs.
 *  - half_open: deja pasar hasta halfOpenProbes peticiones de prueba; un éxito
 *    vuelve a closed, un fallo reabre.
 *
 * Config en `CIRCUIT_BREAKER_*` (ver env.ts) y docs/01_ARCHITECTURE.md §13.3.
 */
@Injectable()
export class CircuitBreakerService {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private windowStart = Date.now();
  private openedAt = 0;
  private probesUsed = 0;

  constructor(
    @Inject(CIRCUIT_BREAKER_CONFIG_TOKEN) private readonly config: CircuitBreakerConfig,
  ) {}

  get currentState(): CircuitState {
    return this.state;
  }

  /** True si la llamada al provider puede proceder. */
  allow(): boolean {
    const now = Date.now();
    if (this.state === 'open') {
      if (now - this.openedAt >= this.config.openTimeoutMs) {
        this.state = 'half_open';
        this.probesUsed = 0;
        return true;
      }
      return false;
    }
    if (this.state === 'half_open') {
      if (this.probesUsed < this.config.halfOpenProbes) {
        this.probesUsed += 1;
        return true;
      }
      return false;
    }
    this.rollWindowIfNeeded(now);
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.reset();
      return;
    }
    this.rollWindowIfNeeded(Date.now());
    this.successes += 1;
  }

  recordFailure(): void {
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = Date.now();
      this.reset();
      return;
    }
    this.rollWindowIfNeeded(Date.now());
    this.failures += 1;
    if (this.shouldOpen()) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  private shouldOpen(): boolean {
    const total = this.successes + this.failures;
    if (this.failures >= this.config.failureThreshold) return true;
    if (total >= this.config.failureThreshold) {
      return (this.failures / total) * 100 >= this.config.errorRateThreshold;
    }
    return false;
  }

  private rollWindowIfNeeded(now: number): void {
    if (now - this.windowStart >= this.config.windowMs) {
      this.reset();
      this.windowStart = now;
    }
  }

  private reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.probesUsed = 0;
  }
}
