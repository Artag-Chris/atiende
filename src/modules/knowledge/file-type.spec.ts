import { describe, it, expect } from 'vitest';
import { resolveUploadType, ALLOWED_UPLOAD_EXTENSIONS } from './file-type';

describe('resolveUploadType', () => {
  it('resolves .md from the extension even with a generic browser mimetype', () => {
    expect(resolveUploadType('precios.md', 'application/octet-stream')).toEqual({
      ok: true,
      ext: 'md',
      mimeType: 'text/markdown',
    });
  });

  it('resolves .md when the browser sends no mimetype', () => {
    const result = resolveUploadType('precios.md', '');
    expect(result).toEqual({ ok: true, ext: 'md', mimeType: 'text/markdown' });
  });

  it('is case insensitive on the extension', () => {
    expect(resolveUploadType('NOTAS.MD', 'text/plain')).toEqual({
      ok: true,
      ext: 'md',
      mimeType: 'text/markdown',
    });
  });

  it('resolves the known office and document formats', () => {
    expect(resolveUploadType('a.txt')).toMatchObject({ ok: true, mimeType: 'text/plain' });
    expect(resolveUploadType('a.pdf')).toMatchObject({ ok: true, mimeType: 'application/pdf' });
    expect(resolveUploadType('a.csv')).toMatchObject({ ok: true, mimeType: 'text/csv' });
    expect(resolveUploadType('a.xlsx')).toMatchObject({
      ok: true,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(resolveUploadType('a.markdown')).toMatchObject({ ok: true, mimeType: 'text/markdown' });
  });

  it('falls back to the mimetype when the extension is unknown', () => {
    expect(resolveUploadType('sin-extension', 'application/pdf')).toEqual({
      ok: true,
      ext: 'pdf',
      mimeType: 'application/pdf',
    });
  });

  it('rejects legacy .xls with an actionable message', () => {
    const result = resolveUploadType('viejo.xls', 'application/vnd.ms-excel');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('.xlsx');
  });

  it('rejects unsupported formats', () => {
    const result = resolveUploadType('malware.exe', 'application/x-msdownload');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Formato no soportado');
  });

  it('rejects an extensionless unknown mimetype', () => {
    expect(resolveUploadType('binario', 'application/octet-stream').ok).toBe(false);
  });

  it('keeps the allowlist in sync with the resolver', () => {
    for (const ext of ALLOWED_UPLOAD_EXTENSIONS) {
      expect(resolveUploadType(`archivo.${ext}`).ok).toBe(true);
    }
  });
});
