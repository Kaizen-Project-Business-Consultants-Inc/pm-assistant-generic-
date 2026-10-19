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
 * Split text into chunks of approximately maxTokens tokens (~4 chars per token) for search.
 * Each chunk ends at a paragraph or sentence break where it can, and the next one starts
 * `overlapRatio` of a chunk earlier (at a sentence or word start), so a sentence cut at a
 * boundary is still whole in one of the two (RAG-1, 2026-10-19 — there was no overlap).
 */
export function chunkText(text: string, maxTokens = 1000, overlapRatio = 0.15): string[] {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return [text];
  // at most 40%: each piece ends at least half a chunk on, so the next start always moves forward
  const overlap = Math.floor(maxChars * Math.min(Math.max(overlapRatio, 0), 0.4));

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      // a break found ending at `end` would make the piece 2 characters too long: look before it
      const paragraphBreak = text.lastIndexOf('\n\n', end - 2);
      if (paragraphBreak > start + maxChars * 0.5) {
        end = paragraphBreak + 2;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end - 2);
        if (sentenceBreak > start + maxChars * 0.5) {
          end = sentenceBreak + 2;
        }
      }
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;

    // Back up by the overlap, then forward to the next sentence (else word) start inside it.
    // end is at least half a chunk past start and the overlap at most 40%, so this always moves forward.
    const from = end - overlap;
    const sentence = text.indexOf('. ', from);
    const space = text.indexOf(' ', from);
    let next = from;
    if (sentence !== -1 && sentence + 2 < end) next = sentence + 2;
    else if (space !== -1 && space + 1 < end) next = space + 1;
    start = Math.max(next, start + 1);
  }

  return chunks.filter(c => c.length > 0);
}
