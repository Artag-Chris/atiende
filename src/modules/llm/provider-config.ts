import type { AIConfig, LLMProviderConfig, LLMProviderName } from '@config/ai.config';
import type { Features } from '@config/features';

/**
 * Bloque de configuración que le toca a un provider dado, según si es el
 * primario o el fallback de las feature flags.
 */
export function providerBlockFor(
  features: Features,
  aiConfig: AIConfig,
  provider: LLMProviderName,
): LLMProviderConfig {
  return features.llm.primary === provider
    ? aiConfig.primary
    : (aiConfig.fallback ?? aiConfig.primary);
}
