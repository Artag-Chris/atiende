import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Global, Module, type DynamicModule, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqModule } from '../groq/groq.module';
import { KimiModule } from '../kimi/kimi.module';
import { MockLLMModule } from '../mock/mock-llm.module';
import { LLMRouterModule } from './llm-router.module';
import { LLMRouterService } from './llm-router.service';
import { GroqAdapter } from '../groq/groq.adapter';
import { KimiAdapter } from '../kimi/kimi.adapter';
import {
  AI_CONFIG_TOKEN,
  CIRCUIT_BREAKER_CONFIG_TOKEN,
  FEATURES_TOKEN,
  LLM_PROVIDER_TOKEN,
} from '@core/tokens';
import type { AIConfig, CircuitBreakerConfig } from '@config/ai.config';
import type { Features } from '@config/features';

const aiConfig = {
  primary: {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    effort: 'medium',
    maxTokens: 4096,
    timeoutMs: 30000,
    maxRetries: 2,
  },
  fallback: {
    provider: 'kimi',
    model: 'kimi-k3',
    effort: 'medium',
    maxTokens: 4096,
    timeoutMs: 30000,
    maxRetries: 2,
  },
} as unknown as AIConfig;

const circuitBreakerConfig: CircuitBreakerConfig = {
  failureThreshold: 5,
  errorRateThreshold: 50,
  windowMs: 60000,
  openTimeoutMs: 30000,
  halfOpenProbes: 1,
};

function makeConfigService() {
  return { get: () => 'test-key' } as unknown as ConfigService;
}

@Global()
@Module({})
class TestConfigModule {
  static forRoot(features: Features) {
    return {
      module: TestConfigModule,
      providers: [
        { provide: FEATURES_TOKEN, useValue: features },
        { provide: AI_CONFIG_TOKEN, useValue: aiConfig },
        { provide: CIRCUIT_BREAKER_CONFIG_TOKEN, useValue: circuitBreakerConfig },
        { provide: ConfigService, useValue: makeConfigService() },
      ],
      exports: [FEATURES_TOKEN, AI_CONFIG_TOKEN, CIRCUIT_BREAKER_CONFIG_TOKEN, ConfigService],
    };
  }
}

function buildApp(features: Features, modules: Array<Type<unknown> | DynamicModule>) {
  return Test.createTestingModule({
    imports: [TestConfigModule.forRoot(features), ...modules],
  }).compile();
}

describe('LLMRouterModule (DI wiring)', () => {
  it('ata primario y fallback a sus adapters con el bloque de config correcto', async () => {
    const features = { llm: { primary: 'groq', fallback: 'kimi' } } as unknown as Features;

    const moduleRef = await buildApp(features, [
      GroqModule,
      KimiModule,
      LLMRouterModule.forRoot('groq', 'kimi'),
    ]);
    await moduleRef.init();

    expect(moduleRef.get(LLM_PROVIDER_TOKEN)).toBeInstanceOf(LLMRouterService);

    const groq = moduleRef.get(GroqAdapter);
    const kimi = moduleRef.get(KimiAdapter);
    expect((groq as unknown as { model: string }).model).toBe('llama-3.3-70b-versatile');
    expect((kimi as unknown as { model: string }).model).toBe('kimi-k3');
  });

  it('resuelve sin fallback cuando no hay provider de fallback', async () => {
    const features = { llm: { primary: 'groq', fallback: null } } as unknown as Features;

    const moduleRef = await buildApp(features, [GroqModule, LLMRouterModule.forRoot('groq', null)]);
    await moduleRef.init();

    expect(moduleRef.get(LLM_PROVIDER_TOKEN)).toBeInstanceOf(LLMRouterService);
  });

  it('cae al mock para providers sin adapter implementado (p.ej. claude)', async () => {
    const features = { llm: { primary: 'claude', fallback: null } } as unknown as Features;

    const moduleRef = await buildApp(features, [
      MockLLMModule,
      LLMRouterModule.forRoot('claude', null),
    ]);
    await moduleRef.init();

    expect(moduleRef.get(LLM_PROVIDER_TOKEN)).toBeInstanceOf(LLMRouterService);
  });
});
