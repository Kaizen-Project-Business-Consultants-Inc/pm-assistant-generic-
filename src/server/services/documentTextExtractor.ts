import logger from '../utils/logger';

const MAX_TEXT_LENGTH = 100_000;

/**
 * Extract text from a document buffer based on MIME type.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  let text = '';

  if (mimeType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(buffer);
    text = pdfData.text;
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    // Plain text, CSV, Markdown, etc.
    text = buffer.toString('utf-8');
  }

  if (text.length > MAX_TEXT_LENGTH) {
    logger.warn(`Document text truncated from ${text.length} to ${MAX_TEXT_LENGTH} chars`);
    text = text.slice(0, MAX_TEXT_LENGTH);
  }

  return text;
}

/**
 * Split text into chunks of approximately maxTokens tokens (~4 chars per token).
 */
export function chunkText(text: string, maxTokens = 1000): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + maxChars * 0.5) {
        end = paragraphBreak + 2;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > start + maxChars * 0.5) {
          end = sentenceBreak + 2;
        }
      }
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  return chunks.filter(c => c.length > 0);
}
