import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { EmbeddingProviderPort } from '@core/ports/embedding-provider.port';
import { AI_CONFIG_TOKEN } from '@core/tokens';
import type { AIConfig } from '@config/ai.config';

@Injectable()
export class OpenAIEmbeddingsAdapter implements EmbeddingProviderPort {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAIEmbeddingsAdapter.name);
  private readonly client: OpenAI;
  private readonly model = 'text-embedding-3-small';
  private readonly dimensions = 1536;

  constructor(@Inject(AI_CONFIG_TOKEN) private readonly config: AIConfig) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const startTime = Date.now();
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });

    const vectors = response.data.map((item) => item.embedding);
    this.logger.log(
      `Embedded ${texts.length} texts in ${Date.now() - startTime}ms (${response.usage.total_tokens} tokens)`,
    );
    return vectors;
  }

  dimension(): number {
    return this.dimensions;
  }
}
