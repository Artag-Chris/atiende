/**
 * Resolución del tipo de archivo subido para ingesta de conocimiento.
 *
 * La EXTENSIÓN manda sobre el mimetype: los navegadores reportan MIME
 * inconsistente para .md/.txt (a veces application/octet-stream o vacío),
 * así que validar solo por MIME rechazaría archivos perfectamente válidos.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export const ALLOWED_UPLOAD_EXTENSIONS = Object.keys(MIME_BY_EXTENSION);

const ALLOWED_LIST = ALLOWED_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(', ');

export type UploadTypeResult =
  | { ok: true; ext: string; mimeType: string }
  | { ok: false; reason: string };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot === -1 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function resolveUploadType(originalname: string, mimetype?: string): UploadTypeResult {
  const ext = extensionOf(originalname ?? '');
  const mimeByExt = MIME_BY_EXTENSION[ext];

  if (mimeByExt) {
    return { ok: true, ext, mimeType: mimeByExt };
  }

  if (ext === 'xls') {
    return {
      ok: false,
      reason:
        'El formato .xls (Excel antiguo) no está soportado. Abre el archivo y guárdalo como .xlsx.',
    };
  }

  const mime = (mimetype ?? '').toLowerCase();
  const extByMime = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === mime);
  if (extByMime) {
    return { ok: true, ext: extByMime[0], mimeType: mime };
  }

  const label = ext ? `.${ext}` : 'sin extensión';
  return {
    ok: false,
    reason: `Formato no soportado (${label}). Permitidos: ${ALLOWED_LIST}.`,
  };
}
