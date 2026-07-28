import { describe, it, expect } from 'vitest';
import { TextChunker } from './text-chunker';

describe('TextChunker', () => {
  const chunker = new TextChunker(50, 10);

  it('returns empty array for empty text', () => {
    expect(chunker.chunk({ text: '' })).toEqual([]);
    expect(chunker.chunk({ text: '   ' })).toEqual([]);
  });

  it('returns single chunk when text fits in max size', () => {
    const chunks = chunker.chunk({ text: 'Hello world' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world');
    expect(chunks[0].position).toBe(0);
  });

  it('splits text into multiple chunks by paragraphs', () => {
    const text = 'A'.repeat(60) + '\n\n' + 'B'.repeat(60);
    const chunks = chunker.chunk({ text });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('A');
    expect(chunks[1].text).toContain('B');
  });

  it('assigns page number when provided', () => {
    const chunks = chunker.chunk({ text: 'Hello', pageNumber: 5 });
    expect(chunks[0].pageNumber).toBe(5);
  });

  it('maintains correct position order', () => {
    const text = 'A'.repeat(60) + '\n\n' + 'B'.repeat(60) + '\n\n' + 'C'.repeat(60);
    const chunks = chunker.chunk({ text });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].position).toBe(i);
    }
  });
});
