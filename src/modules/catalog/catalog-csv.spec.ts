import { describe, it, expect } from 'vitest';
import { parseCsv, parsePrice, parseInteger, mapColumns, cell } from './catalog-csv';

describe('parseCsv', () => {
  it('parses the header and the data rows', () => {
    const rows = parseCsv('name,price\nWeb,1500\nChatbot,800\n');

    expect(rows).toEqual([
      ['name', 'price'],
      ['Web', '1500'],
      ['Chatbot', '800'],
    ]);
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('name,price\r\nWeb,1500\r\n');

    expect(rows).toEqual([
      ['name', 'price'],
      ['Web', '1500'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const rows = parseCsv('name,description\nWeb,"Diseño, desarrollo y soporte"\n');

    expect(rows[1]).toEqual(['Web', 'Diseño, desarrollo y soporte']);
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('name,description\nWeb,"Página ""premium"""\n');

    expect(rows[1][1]).toBe('Página "premium"');
  });

  it('keeps a quoted multiline field as one value', () => {
    const rows = parseCsv('name,description\nWeb,"linea 1\nlinea 2"\n');

    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe('linea 1\nlinea 2');
  });

  it('skips blank lines', () => {
    const rows = parseCsv('name,price\n\nWeb,1500\n\n');

    expect(rows).toEqual([
      ['name', 'price'],
      ['Web', '1500'],
    ]);
  });

  it('parses a last row without trailing newline', () => {
    const rows = parseCsv('name,price\nWeb,1500');

    expect(rows[1]).toEqual(['Web', '1500']);
  });
});

describe('parsePrice', () => {
  it('parses plain numbers', () => {
    expect(parsePrice('1500')).toBe(1500);
    expect(parsePrice('1500.5')).toBe(1500.5);
  });

  it('strips currency symbols and thousand separators', () => {
    expect(parsePrice('$1,500.00')).toBe(1500);
    expect(parsePrice('USD 2000')).toBe(2000);
  });

  it('treats a lone comma as the decimal separator', () => {
    expect(parsePrice('1500,50')).toBe(1500.5);
  });

  it('returns 0 for an explicit zero', () => {
    expect(parsePrice('0')).toBe(0);
  });

  it('returns null for empty or unparseable values', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('   ')).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice('a cotizar')).toBeNull();
  });
});

describe('parseInteger', () => {
  it('truncates and falls back when absent', () => {
    expect(parseInteger('12', 0)).toBe(12);
    expect(parseInteger('12.9', 0)).toBe(12);
    expect(parseInteger(undefined, 0)).toBe(0);
    expect(parseInteger('', 5)).toBe(5);
  });
});

describe('mapColumns', () => {
  it('maps the canonical headers', () => {
    const columns = mapColumns(['name', 'description', 'price', 'stock', 'category', 'image_url']);

    expect(columns).toEqual({
      name: 0,
      description: 1,
      price: 2,
      stock: 3,
      category: 4,
      imageUrl: 5,
    });
  });

  it('accepts spanish aliases and is case/space insensitive', () => {
    const columns = mapColumns([' Nombre ', 'Precio', 'Descripción']);

    expect(columns.name).toBe(0);
    expect(columns.price).toBe(1);
    expect(columns.description).toBe(2);
  });

  it('reports -1 for missing columns', () => {
    const columns = mapColumns(['precio']);

    expect(columns.name).toBe(-1);
    expect(columns.stock).toBe(-1);
  });
});

describe('cell', () => {
  it('reads and trims a column by index', () => {
    expect(cell(['  Web  ', '1500'], 0)).toBe('Web');
  });

  it('returns undefined for unknown columns and missing cells', () => {
    expect(cell(['Web'], -1)).toBeUndefined();
    expect(cell(['Web'], 3)).toBeUndefined();
  });
});
