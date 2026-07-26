/**
 * Strip dangerous HTML tags and attributes from user input.
 * Preserves markdown and safe inline HTML (b, em, code, etc.).
 */
export function stripDangerousHtml(input: string): string {
  return input
    // Remove <script>, <iframe>, <object>, <embed>, <link> tags and their content
    .replace(/<(script|iframe|object|embed|link)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove self-closing / unclosed versions of those tags
    .replace(/<(script|iframe|object|embed|link)\b[^>]*\/?>/gi, '')
    // Remove on* event handlers (e.g. onclick="...", onerror='...')
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript: URLs
    .replace(/javascript\s*:/gi, '');
}
