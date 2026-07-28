import { Injectable } from '@nestjs/common';
import type { ChunkerPort, ChunkInput, ChunkResult } from '@core/ports/chunker.port';

@Injectable()
export class TextChunker implements ChunkerPort {
  private readonly maxChunkSize: number;
  private readonly overlap: number;

  constructor(maxChunkSize = 1000, overlap = 200) {
    this.maxChunkSize = maxChunkSize;
    this.overlap = overlap;
  }

  chunk(input: ChunkInput): ChunkResult[] {
    const { text, pageNumber } = input;
    const chunks: ChunkResult[] = [];

    if (!text || text.trim().length === 0) return chunks;

    const paragraphs = text.split(/\n\n+/);
    let current = '';
    let position = 0;

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (current.length + trimmed.length + 2 > this.maxChunkSize && current.length > 0) {
        chunks.push({ text: current.trim(), position: position++, pageNumber });
        current = this.extractOverlap(current);
      }

      current = current.length > 0 ? `${current}\n\n${trimmed}` : trimmed;
    }

    if (current.trim().length > 0) {
      chunks.push({ text: current.trim(), position: position++, pageNumber });
    }

    return chunks;
  }

  private extractOverlap(text: string): string {
    const words = text.split(/\s+/);
    const overlapWords: string[] = [];
    let len = 0;

    for (let i = words.length - 1; i >= 0; i--) {
      if (len + words[i].length + 1 > this.overlap) break;
      overlapWords.unshift(words[i]);
      len += words[i].length + 1;
    }

    return overlapWords.join(' ');
  }
}
