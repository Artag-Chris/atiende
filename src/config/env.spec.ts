import { describe, it, expect } from 'vitest';
import { EnvSchema } from './env';

function baseEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://atiende:atiende_dev@localhost:5432/atiende?schema=public',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    META_APP_ID: 'app',
    META_APP_SECRET: 'secret',
    META_WEBHOOK_VERIFY_TOKEN: 'verify-token',
    ENCRYPTION_MASTER_KEY: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
    JWT_SECRET: 'jwt-secret-min-16-characters',
    JWT_REFRESH_SECRET: 'jwt-refresh-secret-min-16',
  };
}

describe('EnvSchema cross-field validation', () => {
  it('accepts groq as primary without KIMI_API_KEY', () => {
    const result = EnvSchema.safeParse(baseEnv());
    expect(result.success).toBe(true);
  });

  it('rejects kimi as primary without KIMI_API_KEY', () => {
    const result = EnvSchema.safeParse({ ...baseEnv(), FEATURE_LLM_PRIMARY: 'kimi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'KIMI_API_KEY');
      expect(issue).toBeDefined();
    }
  });

  it('rejects kimi as fallback without KIMI_API_KEY', () => {
    const result = EnvSchema.safeParse({ ...baseEnv(), FEATURE_LLM_FALLBACK: 'kimi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'KIMI_API_KEY');
      expect(issue).toBeDefined();
    }
  });

  it('accepts kimi as primary with KIMI_API_KEY', () => {
    const result = EnvSchema.safeParse({
      ...baseEnv(),
      FEATURE_LLM_PRIMARY: 'kimi',
      KIMI_API_KEY: 'sk-kimi',
    });
    expect(result.success).toBe(true);
  });
});
