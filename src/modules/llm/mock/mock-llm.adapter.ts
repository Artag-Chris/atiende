import { Injectable } from '@nestjs/common';
import type { ChatRequest, ChatResponse, LLMProviderPort } from '@core/ports/llm-provider.port';

@Injectable()
export class MockLLMAdapter implements LLMProviderPort {
  readonly name = 'mock';

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    throw new Error(
      'No LLM provider configured. Set FEATURE_LLM_PRIMARY=openai or implement a ClaudeModule.',
    );
  }

  async isHealthy(): Promise<boolean> {
    return false;
  }
}
