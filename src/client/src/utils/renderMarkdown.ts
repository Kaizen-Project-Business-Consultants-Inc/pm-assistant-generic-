/**
 * Simple regex-based markdown renderer.
 * Shared between QueryPage and ProjectBriefCard.
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-gray-900 dark:text-white mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-gray-900 dark:text-white mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2">$1</h1>')
    // Inline code (before bold/italic to avoid conflicts)
    .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-sm font-mono text-gray-800 dark:text-gray-200">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary-600 dark:text-primary-400 underline hover:text-primary-700 dark:hover:text-primary-300">$1</a>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-2">')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(
    /(<li[^>]*>.*?<\/li>\s*)+/g,
    (match) => `<ul class="list-disc space-y-1 mb-3">${match}</ul>`
  );

  return `<p class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-2">${html}</p>`;
}
