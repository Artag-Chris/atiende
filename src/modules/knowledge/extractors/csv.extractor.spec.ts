import { describe, it, expect } from 'vitest';
import { CsvExtractor } from './csv.extractor';

describe('CsvExtractor', () => {
  const extractor = new CsvExtractor();

  it('extracts CSV content', async () => {
    const csv = 'name,price\nLaptop,1000\nMouse,25\n';
    const result = await extractor.extract(Buffer.from(csv));
    expect(result.text).toContain('CSV Import');
    expect(result.text).toContain('Row 1: Laptop,1000');
    expect(result.text).toContain('Row 2: Mouse,25');
    expect(result.metadata.rowCount).toBe(2);
  });

  it('handles empty CSV', async () => {
    const result = await extractor.extract(Buffer.from(''));
    expect(result.text).toBe('CSV Import - Headers: \n');
  });

  it('supports text/csv mime type', () => {
    expect(extractor.supportedMimeTypes).toContain('text/csv');
  });
});
