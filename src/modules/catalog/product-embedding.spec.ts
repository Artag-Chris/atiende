import { describe, it, expect } from 'vitest';
import { productEmbeddingText } from './product-embedding';

describe('productEmbeddingText', () => {
  it('joins name and description', () => {
    expect(productEmbeddingText({ name: 'Desarrollo Web', description: 'Sitio premium' })).toBe(
      'Desarrollo Web\nSitio premium',
    );
  });

  it('uses only the name when there is no description', () => {
    expect(productEmbeddingText({ name: 'Desarrollo Web', description: null })).toBe(
      'Desarrollo Web',
    );
  });
});
