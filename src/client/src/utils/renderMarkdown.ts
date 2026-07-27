import { marked } from 'marked';

// Configure marked for safe, styled output
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Custom renderer: only add target="_blank" to off-origin links
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  // Absolute URLs pointing to a different origin open in a new tab
  const isExternal = href && /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin);
  const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${href}"${titleAttr}${targetAttr}>${text}</a>`;
};

/**
 * Render markdown to HTML using the `marked` parser.
 * Shared between QueryPage and ProjectBriefCard.
 *
 * Consumers should wrap the output in a container with prose-sm or
 * equivalent Tailwind typography classes for consistent styling.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  return marked.parse(text, { async: false, renderer }) as string;
}
