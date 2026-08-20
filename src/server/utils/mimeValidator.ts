/**
 * MIME type validation for file uploads.
 *
 * Two layers:
 * 1. Allowlist — reject disallowed MIME types outright
 * 2. Magic bytes — verify the file content matches the declared MIME type
 */

/** Allowed MIME types for file attachments */
const ALLOWED_MIME_TYPES = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/vtt',
  'application/x-subrip',
  'application/rtf',

  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',

  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',

  // Data
  'application/json',
  'application/xml',
  'text/xml',
]);

/** Magic byte signatures for common file types */
const MAGIC_SIGNATURES: Array<{ bytes: number[]; offset?: number; mimes: string[] }> = [
  // PDF: %PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], mimes: ['application/pdf'] },
  // PNG: 89 50 4E 47
  { bytes: [0x89, 0x50, 0x4E, 0x47], mimes: ['image/png'] },
  // JPEG: FF D8 FF
  { bytes: [0xFF, 0xD8, 0xFF], mimes: ['image/jpeg'] },
  // GIF: GIF87a or GIF89a
  { bytes: [0x47, 0x49, 0x46, 0x38], mimes: ['image/gif'] },
  // ZIP (also DOCX, XLSX, PPTX): PK
  { bytes: [0x50, 0x4B, 0x03, 0x04], mimes: [
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]},
  // GZIP: 1F 8B
  { bytes: [0x1F, 0x8B], mimes: ['application/gzip'] },
  // MS Office legacy (DOC, XLS, PPT): D0 CF 11 E0
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], mimes: [
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  ]},
  // WebP: RIFF....WEBP
  { bytes: [0x52, 0x49, 0x46, 0x46], mimes: ['image/webp'] },
  // BMP: BM
  { bytes: [0x42, 0x4D], mimes: ['image/bmp'] },
];

/** Text-based MIME types that won't have magic bytes */
const TEXT_MIME_TYPES = new Set([
  'text/plain', 'text/csv', 'text/markdown', 'text/vtt', 'text/xml',
  'application/x-subrip',
  'application/json', 'application/xml', 'application/rtf',
]);

export interface MimeValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a file upload's MIME type against the allowlist and verify
 * content matches via magic bytes inspection.
 */
export function validateMimeType(declaredMime: string, buffer: Buffer): MimeValidationResult {
  const mime = declaredMime.toLowerCase().split(';')[0].trim();

  // 1. Allowlist check
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { valid: false, error: `File type '${mime}' is not allowed. Allowed types: documents, images, archives, and data files.` };
  }

  // 2. Text-based types — can't verify with magic bytes, but allowed
  if (TEXT_MIME_TYPES.has(mime)) {
    return { valid: true };
  }

  // 3. Magic bytes verification — ensure content matches declared type
  if (buffer.length < 2) {
    return { valid: false, error: 'File is too small to verify content type.' };
  }

  const matchedSignature = MAGIC_SIGNATURES.find(sig => {
    const offset = sig.offset || 0;
    if (buffer.length < offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[offset + i] === byte);
  });

  if (!matchedSignature) {
    // No magic match — allow if it's a type we don't have signatures for (e.g., RTF detected as text)
    return { valid: true };
  }

  // Verify the declared MIME matches the detected content
  if (!matchedSignature.mimes.includes(mime)) {
    return {
      valid: false,
      error: `File content does not match declared type '${mime}'. The file appears to be a different format.`,
    };
  }

  return { valid: true };
}

/** Get the set of allowed MIME types (for documentation/error messages) */
export function getAllowedMimeTypes(): string[] {
  return Array.from(ALLOWED_MIME_TYPES).sort();
}
