/**
 * Parseo del CSV de catálogo (FR-6).
 *
 * Columnas esperadas: name, description, price, stock, category, image_url
 * (se aceptan alias en español). Solo `name` es obligatorio.
 *
 * Parser propio y mínimo: el repo no tiene dependencia de CSV y solo se
 * necesita lo justo — comillas dobles, comillas escapadas, CRLF y líneas vacías.
 */

export interface ColumnMap {
  name: number;
  description: number;
  price: number;
  stock: number;
  category: number;
  imageUrl: number;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Acepta "1500", "1500.50", "$1,500.00" y "1500,50". null = no parseable. */
export function parsePrice(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  if (cleaned === '') return null;

  const normalized =
    cleaned.includes(',') && !cleaned.includes('.')
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseInteger(raw: string | undefined, fallback: number): number {
  const value = parsePrice(raw);
  return value === null ? fallback : Math.trunc(value);
}

export function mapColumns(header: string[]): ColumnMap {
  const normalized = header.map((cell) => cell.trim().toLowerCase());
  const indexOf = (aliases: string[]): number =>
    normalized.findIndex((cell) => aliases.includes(cell));

  return {
    name: indexOf(['name', 'nombre']),
    description: indexOf(['description', 'descripcion', 'descripción']),
    price: indexOf(['price', 'precio']),
    stock: indexOf(['stock', 'disponibilidad', 'cantidad']),
    category: indexOf(['category', 'categoria', 'categoría']),
    imageUrl: indexOf(['image_url', 'imagen', 'image']),
  };
}

export function cell(row: string[], index: number): string | undefined {
  if (index < 0) return undefined;
  return row[index]?.trim();
}
