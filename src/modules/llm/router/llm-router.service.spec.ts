import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMRouterService, LLMProviderUnavailableError } from './llm-router.service';
import type { LLMProviderPort, ChatResponse, ChatRequest } from '@core/ports/llm-provider.port';
import type { CircuitBreakerService } from './circuit-breaker.service';

function makeResponse(model: string): ChatResponse {
  return {
    text: `respuesta de ${model}`,
    toolCalls: [],
    stopReason: 'end_turn',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    costUsd: 0,
    model,
  };
}

function makeProvider(name: string) {
  return {
    name,
    chat: vi.fn(),
    isHealthy: vi.fn(),
  };
}

function makeCircuitBreaker() {
  return {
    allow: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
}

type ProviderMock = ReturnType<typeof makeProvider>;
type CircuitBreakerMock = ReturnType<typeof makeCircuitBreaker>;

function buildRouter(
  primary: ProviderMock,
  fallback: ProviderMock | null,
  cb: CircuitBreakerMock,
): LLMRouterService {
  return new LLMRouterService(
    primary as unknown as LLMProviderPort,
    fallback as unknown as LLMProviderPort | null,
    cb as unknown as CircuitBreakerService,
  );
}

const req: ChatRequest = {
  systemPrompt: 'System',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hola' }] }],
  maxTokens: 1024,
};

describe('LLMRouterService', () => {
  let primary: ProviderMock;
  let fallback: ProviderMock;
  let cb: CircuitBreakerMock;
  let router: LLMRouterService;

  beforeEach(() => {
    primary = makeProvider('groq');
    fallback = makeProvider('kimi');
    cb = makeCircuitBreaker();
  });

  describe('con fallback', () => {
    beforeEach(() => {
      router = buildRouter(primary, fallback, cb);
    });

    it('delega al primario y registra éxito cuando responde', async () => {
      primary.chat.mockResolvedValue(makeResponse('groq'));

      const result = await router.chat(req);

      expect(result.model).toBe('groq');
      expect(primary.chat).toHaveBeenCalledWith(req);
      expect(cb.recordSuccess).toHaveBeenCalledTimes(1);
      expect(cb.recordFailure).not.toHaveBeenCalled();
      expect(fallback.chat).not.toHaveBeenCalled();
    });

    it('hace fallback al fallback y registra el fallo cuando el primario falla', async () => {
      primary.chat.mockRejectedValue(new Error('boom'));
      fallback.chat.mockResolvedValue(makeResponse('kimi'));

      const result = await router.chat(req);

      expect(result.model).toBe('kimi');
      expect(cb.recordFailure).toHaveBeenCalledTimes(1);
      expect(cb.recordSuccess).not.toHaveBeenCalled();
      expect(fallback.chat).toHaveBeenCalledWith(req);
    });

    it('hace fallback sin tocar al primario cuando el breaker está abierto', async () => {
      cb.allow.mockReturnValue(false);
      fallback.chat.mockResolvedValue(makeResponse('kimi'));

      const result = await router.chat(req);

      expect(result.model).toBe('kimi');
      expect(primary.chat).not.toHaveBeenCalled();
      expect(cb.recordFailure).not.toHaveBeenCalled();
    });
  });

  describe('sin fallback', () => {
    beforeEach(() => {
      router = buildRouter(primary, null, cb);
    });

    it('lanza LLMProviderUnavailableError cuando el primario falla', async () => {
      primary.chat.mockRejectedValue(new Error('boom'));

      await expect(router.chat(req)).rejects.toBeInstanceOf(LLMProviderUnavailableError);
      expect(cb.recordFailure).toHaveBeenCalledTimes(1);
    });

    it('lanza LLMProviderUnavailableError cuando el breaker está abierto', async () => {
      cb.allow.mockReturnValue(false);

      await expect(router.chat(req)).rejects.toBeInstanceOf(LLMProviderUnavailableError);
      expect(primary.chat).not.toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('es healthy si el primario lo es', async () => {
      router = buildRouter(primary, fallback, cb);
      primary.isHealthy.mockResolvedValue(true);

      await expect(router.isHealthy()).resolves.toBe(true);
      expect(fallback.isHealthy).not.toHaveBeenCalled();
    });

    it('consulta el fallback si el primario no está healthy', async () => {
      router = buildRouter(primary, fallback, cb);
      primary.isHealthy.mockResolvedValue(false);
      fallback.isHealthy.mockResolvedValue(true);

      await expect(router.isHealthy()).resolves.toBe(true);
    });

    it('es false si ambos fallan', async () => {
      router = buildRouter(primary, null, cb);
      primary.isHealthy.mockResolvedValue(false);

      await expect(router.isHealthy()).resolves.toBe(false);
    });
  });
});
