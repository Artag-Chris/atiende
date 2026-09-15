import { Injectable, Logger } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { DocumentExtractorPort, ExtractResult } from '@core/ports/document-extractor.port';

/**
 * Extractor de hojas de cálculo Excel (.xlsx).
 *
 * Usa exceljs y no `xlsx` (SheetJS) porque la versión publicada en npm de
 * `xlsx` está congelada en 0.18.5 con un advisory de prototype pollution
 * (CVE-2023-30533) y la parcheada solo se distribuye por el CDN de SheetJS.
 *
 * Solo .xlsx: exceljs no lee el formato binario antiguo .xls (BIFF).
 */
@Injectable()
export class ExcelExtractor implements DocumentExtractorPort {
  readonly supportedMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  private readonly logger = new Logger(ExcelExtractor.name);

  async extract(content: Buffer): Promise<ExtractResult> {
    try {
      const workbook = new Workbook();
      // exceljs tipa `load` contra su propia definición de Buffer, incompatible
      // con la de @types/node v22 (son equivalentes en runtime).
      type XlsxLoadInput = Parameters<Workbook['xlsx']['load']>[0];
      await workbook.xlsx.load(content as unknown as XlsxLoadInput);

      const lines: string[] = [];
      let rowCount = 0;

      for (const sheet of workbook.worksheets) {
        const rows: string[][] = [];

        sheet.eachRow({ includeEmpty: false }, (row) => {
          const raw = row.values;
          const cells = Array.isArray(raw) ? raw.slice(1) : [];
          const values = cells.map((cell) => this.cellToString(cell));
          if (values.some((value) => value.length > 0)) rows.push(values);
        });

        if (rows.length === 0) continue;

        lines.push(`Hoja: ${sheet.name}`);
        lines.push(`Columnas: ${rows[0].join(' | ')}`);
        rows.slice(1).forEach((row, index) => {
          lines.push(`Fila ${index + 1}: ${row.join(' | ')}`);
        });
        lines.push('');

        rowCount += Math.max(rows.length - 1, 0);
      }

      const text = lines.join('\n').trim();
      if (!text) {
        return { text: '', metadata: { error: 'empty workbook' } };
      }

      return {
        text,
        metadata: {
          sheetCount: workbook.worksheets.length,
          rowCount,
        },
      };
    } catch (error) {
      this.logger.error(`Excel extraction failed: ${error}`);
      return { text: '', metadata: { error: String(error) } };
    }
  }

  /**
   * exceljs puede devolver celdas como objetos (rich text, fórmula, hyperlink).
   * Se normalizan a texto plano para que el chunker reciba strings.
   */
  private cellToString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();

    if (typeof value === 'object') {
      const cell = value as Record<string, unknown>;

      if (Array.isArray(cell.richText)) {
        return cell.richText.map((part) => (part as { text?: string })?.text ?? '').join('');
      }
      if ('text' in cell) return String(cell.text ?? '');
      if ('result' in cell) return String(cell.result ?? '');
      if ('error' in cell) return String(cell.error ?? '');

      return '';
    }

    return String(value);
  }
}
