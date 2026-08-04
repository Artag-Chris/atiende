import { describe, it, expect } from 'vitest';
import { EnvSchema } from './env';
import { buildAIConfig } from './ai.config';

function buildEnv(overrides: Record<string, string>) {
  const result = EnvSchema.safeParse({
    DATABASE_URL: 'postgresql://atiende:atiende_dev@localhost:5432/atiende?schema=public',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    META_APP_ID: 'app',
    META_APP_SECRET: 'secret',
    META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    ENCRYPTION_MASTER_KEY: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
    JWT_SECRET: 'jwt-secret-min-16-characters',
    JWT_REFRESH_SECRET: 'jwt-refresh-secret-min-16',
    ...overrides,
  });
  if (!result.success) {
    throw new Error(`Invalid env fixture: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

describe('buildAIConfig maxTokens per provider', () => {
  it('uses KIMI_MAX_TOKENS when kimi is primary', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
      KIMI_MAX_TOKENS: '8192',
      ANTHROPIC_MAX_TOKENS: '4096',
    });
    expect(buildAIConfig(env).primary.maxTokens).toBe(8192);
  });

  it('uses ANTHROPIC_MAX_TOKENS when kimi is not primary', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      ANTHROPIC_MAX_TOKENS: '4096',
    });
    expect(buildAIConfig(env).primary.maxTokens).toBe(4096);
  });

  it('uses KIMI_MAX_TOKENS when kimi is fallback', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      FEATURE_LLM_FALLBACK: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
      KIMI_MAX_TOKENS: '6144',
      ANTHROPIC_MAX_TOKENS: '4096',
    });
    expect(buildAIConfig(env).fallback?.maxTokens).toBe(6144);
  });

  it('carries the primary effort through to the config', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
      ANTHROPIC_EFFORT: 'high',
    });
    expect(buildAIConfig(env).primary.effort).toBe('medium');
  });
});

describe('buildAIConfig analytics (LLM del asesor de growth)', () => {
  it('hereda el provider primario por defecto', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      ANTHROPIC_MAX_TOKENS: '4096',
    });
    const analytics = buildAIConfig(env).analytics;
    expect(analytics.provider).toBe('groq');
    expect(analytics.model).toBe('llama-3.3-70b-versatile');
    expect(analytics.maxTokens).toBe(4096);
  });

  it('permite apuntar a otra IA con ANALYTICS_LLM_*', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      ANALYTICS_LLM_PROVIDER: 'openai',
      ANALYTICS_LLM_MODEL: 'gpt-4o-mini',
      ANALYTICS_LLM_MAX_TOKENS: '2048',
      ANALYTICS_LLM_TIMEOUT_MS: '45000',
      ANALYTICS_LLM_MAX_RETRIES: '1',
    });
    const analytics = buildAIConfig(env).analytics;
    expect(analytics).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      effort: 'medium',
      maxTokens: 2048,
      timeoutMs: 45000,
      maxRetries: 1,
    });
  });

  it('usa KIMI_MAX_TOKENS cuando analytics apunta a kimi', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      ANALYTICS_LLM_PROVIDER: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
      KIMI_MAX_TOKENS: '8192',
      ANTHROPIC_MAX_TOKENS: '4096',
    });
    expect(buildAIConfig(env).analytics.maxTokens).toBe(8192);
  });

  it('mantiene el provider del agente intacto al configurar analytics', () => {
    const env = buildEnv({
      FEATURE_LLM_PRIMARY: 'groq',
      ANALYTICS_LLM_PROVIDER: 'openai',
      ANALYTICS_LLM_MODEL: 'gpt-4o-mini',
    });
    const config = buildAIConfig(env);
    expect(config.primary.provider).toBe('groq');
    expect(config.primary.model).toBe('llama-3.3-70b-versatile');
    expect(config.analytics.provider).toBe('openai');
  });
});
