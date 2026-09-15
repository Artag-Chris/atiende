import { describe, it, expect } from 'vitest';
import { MarkdownExtractor } from './markdown.extractor';

describe('MarkdownExtractor', () => {
  const extractor = new MarkdownExtractor();

  it('returns the markdown text unchanged', async () => {
    const md = '# Precios\n\n## Desarrollo Web\n\nDesde $1500\n';
    const result = await extractor.extract(Buffer.from(md, 'utf-8'));

    expect(result.text).toBe(md);
    expect(result.metadata.charCount).toBe(md.length);
  });

  it('reports the line count', async () => {
    const result = await extractor.extract(Buffer.from('linea1\nlinea2\nlinea3'));

    expect(result.metadata.lineCount).toBe(3);
  });

  it('decodes UTF-8 accents correctly', async () => {
    const md = '# Servicios\n\nDiseño e integración';
    const result = await extractor.extract(Buffer.from(md, 'utf-8'));

    expect(result.text).toContain('Diseño');
    expect(result.text).toContain('integración');
  });

  it('returns empty text for an empty buffer', async () => {
    const result = await extractor.extract(Buffer.from(''));

    expect(result.text).toBe('');
    expect(result.metadata.charCount).toBe(0);
  });

  it('supports markdown and plain text mime types', () => {
    expect(extractor.supportedMimeTypes).toContain('text/markdown');
    expect(extractor.supportedMimeTypes).toContain('text/x-markdown');
    expect(extractor.supportedMimeTypes).toContain('text/plain');
  });
});
