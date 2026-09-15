import { describe, it, expect } from 'vitest';
import { Workbook } from 'exceljs';
import { ExcelExtractor } from './excel.extractor';

async function buildXlsx(
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>,
): Promise<Buffer> {
  const workbook = new Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => worksheet.addRow(row));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('ExcelExtractor', () => {
  const extractor = new ExcelExtractor();

  it('formats a sheet with its columns and rows', async () => {
    const buffer = await buildXlsx([
      {
        name: 'Servicios',
        rows: [
          ['nombre', 'precio'],
          ['Desarrollo Web', 1500],
          ['Chatbot IA', 800],
        ],
      },
    ]);

    const result = await extractor.extract(buffer);

    expect(result.text).toContain('Hoja: Servicios');
    expect(result.text).toContain('Columnas: nombre | precio');
    expect(result.text).toContain('Fila 1: Desarrollo Web | 1500');
    expect(result.text).toContain('Fila 2: Chatbot IA | 800');
    expect(result.metadata.rowCount).toBe(2);
  });

  it('includes every sheet of the workbook', async () => {
    const buffer = await buildXlsx([
      {
        name: 'Servicios',
        rows: [
          ['nombre', 'precio'],
          ['Web', 1500],
        ],
      },
      {
        name: 'Horarios',
        rows: [
          ['dia', 'apertura'],
          ['Lunes', '9:00'],
        ],
      },
    ]);

    const result = await extractor.extract(buffer);

    expect(result.text).toContain('Hoja: Servicios');
    expect(result.text).toContain('Hoja: Horarios');
    expect(result.text).toContain('Fila 1: Lunes | 9:00');
    expect(result.metadata.sheetCount).toBe(2);
  });

  it('returns empty text for a workbook without data rows', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('Vacia');
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await extractor.extract(buffer);

    expect(result.text).toBe('');
  });

  it('returns empty text instead of throwing on a corrupt buffer', async () => {
    const result = await extractor.extract(Buffer.from('no soy un xlsx'));

    expect(result.text).toBe('');
    expect(result.metadata.error).toBeDefined();
  });

  it('only claims the .xlsx mime type (not legacy .xls)', () => {
    expect(extractor.supportedMimeTypes).toEqual([XLSX_MIME]);
    expect(extractor.supportedMimeTypes).not.toContain('application/vnd.ms-excel');
  });
});
