/** Mjuzi replies are markdown; the voice would read the symbols out ("asterisk asterisk"). */
export function toSpeechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')            // code blocks are not worth reading aloud
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')    // image -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // link -> its words
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')          // headings
    .replace(/^\s*>\s?/gm, '')                   // quotes
    .replace(/^\s*[-*+]\s+/gm, '')               // bullets
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, ' ') // table divider rows
    .replace(/^\s*\|\s*|\s*\|\s*$/gm, '')          // outer table pipes
    .replace(/\s*\|\s*/g, ', ')                      // table cell separators
    .replace(/[*_~`]+/g, '')                     // bold, italic, strike, inline code marks
    .replace(/\s*\n\s*/g, '. ')                  // line breaks become a pause
    .replace(/([.!?:;,])\s?\./g, '$1')        // no doubled punctuation from the join
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** True when what Mjuzi says ends by asking the user something (so the mic should open once it stops talking). */
export function endsWithQuestion(markdown: string): boolean {
  return /\?[\s"')\]]*$/.test(toSpeechText(markdown));
}
