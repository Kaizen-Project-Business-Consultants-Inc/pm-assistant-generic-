import { marked } from 'marked';

// Configure marked for safe, styled output
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown to HTML using the `marked` parser.
 * Shared between QueryPage and ProjectBriefCard.
 *
 * Consumers should wrap the output in a container with prose-sm or
 * equivalent Tailwind typography classes for consistent styling.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = marked.parse(text, { async: false }) as string;
  // Add target="_blank" to all links for safety
  html = html.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
  return html;
}
