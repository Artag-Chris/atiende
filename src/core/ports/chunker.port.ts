export interface ChunkInput {
  text: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkResult {
  text: string;
  position: number;
  pageNumber?: number;
}

export interface ChunkerPort {
  chunk(input: ChunkInput): ChunkResult[];
}
