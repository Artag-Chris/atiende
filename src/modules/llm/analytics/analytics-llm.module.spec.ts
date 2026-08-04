import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsLLMModule } from './analytics-llm.module';
import { AI_CONFIG_TOKEN, ANALYTICS_LLM_PROVIDER_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';

function makeConfigService() {
  return { get: () => 'test-key' } as unknown as ConfigService;
}

@Global()
@Module({})
class TestConfigModule {
  static forRoot(aiConfig: AIConfig) {
    return {
      module: TestConfigModule,
      providers: [
        { provide: AI_CONFIG_TOKEN, useValue: aiConfig },
        { provide: ConfigService, useValue: makeConfigService() },
      ],
      exports: [AI_CONFIG_TOKEN, ConfigService],
    };
  }
}

describe('AnalyticsLLMModule (DI wiring)', () => {
  it('construye un adapter con el modelo de analytics cuando se especifica', async () => {
    const aiConfig = {
      analytics: {
        provider: 'groq',
        model: 'llama-3.1-8b-instant',
        effort: 'medium',
        maxTokens: 2048,
        timeoutMs: 30000,
        maxRetries: 2,
      },
    } as unknown as AIConfig;

    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule.forRoot(aiConfig), AnalyticsLLMModule],
    }).compile();
    await moduleRef.init();

    const adapter = moduleRef.get(ANALYTICS_LLM_PROVIDER_TOKEN) as {
      model?: string;
    };
    expect(adapter).toBeDefined();
    expect(adapter.model).toBe('llama-3.1-8b-instant');
  });

  it('cae al mock para providers sin adapter (claude/mock) sin exigir key', async () => {
    const aiConfig = {
      analytics: {
        provider: 'claude',
        model: 'claude-opus-4-7',
        effort: 'medium',
        maxTokens: 4096,
        timeoutMs: 60000,
        maxRetries: 2,
      },
    } as unknown as AIConfig;

    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule.forRoot(aiConfig), AnalyticsLLMModule],
    }).compile();
    await moduleRef.init();

    expect(moduleRef.get(ANALYTICS_LLM_PROVIDER_TOKEN)).toBeDefined();
  });
});
