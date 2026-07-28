export interface EmbeddingProviderPort {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
  dimension(): number;
}
