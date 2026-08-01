import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ChatRequest, ChatResponse, LLMProviderPort } from '@core/ports/llm-provider.port';
import { LLM_PRIMARY_PROVIDER_TOKEN, LLM_PROVIDER_FALLBACK_TOKEN } from '@core/tokens';
import { CircuitBreakerService } from './circuit-breaker.service';

/** Error controlado cuando el provider primario no responde y no hay fallback. */
export class LLMProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMProviderUnavailableError';
  }
}

/**
 * Ruta el tráfico LLM entre el provider primario y el fallback, con circuit
 * breaker sobre el primario (ver docs/01_ARCHITECTURE.md §13.3).
 *
 * - Primario ok: devuelve su respuesta.
 * - Primario falla o el breaker está abierto: delega al fallback (si existe).
 * - Sin fallback y primario no disponible: lanza LLMProviderUnavailableError.
 *
 * Se registra como `LLM_PROVIDER_TOKEN`, así el core (AgentService) habla con
 * esta interfaz sin cambios.
 */
@Injectable()
export class LLMRouterService implements LLMProviderPort {
  readonly name = 'router';
  private readonly logger = new Logger(LLMRouterService.name);

  constructor(
    @Inject(LLM_PRIMARY_PROVIDER_TOKEN) private readonly primary: LLMProviderPort,
    @Optional()
    @Inject(LLM_PROVIDER_FALLBACK_TOKEN)
    private readonly fallback: LLMProviderPort | null,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.circuitBreaker.allow()) {
      return this.attemptFallback(req, 'circuit_open');
    }
    try {
      const response = await this.primary.chat(req);
      this.circuitBreaker.recordSuccess();
      return response;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      this.logger.warn(
        `[LLMRouter] Primary "${this.primary.name}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.attemptFallback(req, 'primary_failure');
    }
  }

  async isHealthy(): Promise<boolean> {
    if (await this.primary.isHealthy()) return true;
    return this.fallback ? this.fallback.isHealthy() : false;
  }

  private async attemptFallback(req: ChatRequest, reason: string): Promise<ChatResponse> {
    if (!this.fallback) {
      throw new LLMProviderUnavailableError(
        `LLM primary "${this.primary.name}" unavailable (${reason}) and no fallback configured`,
      );
    }
    this.logger.warn(`[LLMRouter] Falling back to "${this.fallback.name}" (${reason})`);
    return this.fallback.chat(req);
  }
}
