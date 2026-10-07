import logger from './logger';

/**
 * The status report's Timeline strip as a picture (2026-10-07). On screen and in the PDF/HTML
 * downloads it is an inline SVG; email programs (Gmail, Outlook) don't show inline SVG, and Word
 * needs an image — so for those the same SVG is turned into a PNG.
 */

/** The renderer wraps the strip's SVG in these markers so email can swap it for a picture */
export const TIMELINE_START = '<!--kv-timeline-->';
export const TIMELINE_END = '<!--/kv-timeline-->';
export const TIMELINE_CID = 'kv-timeline';

/** SVG → PNG (2× for sharpness). null if the image library isn't available — callers carry on without */
export async function svgToPng(svg: string, width = 1000): Promise<Buffer | null> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(Buffer.from(svg), { density: 144 }).resize({ width: width * 2 }).png().toBuffer();
  } catch (err) {
    logger.warn('[report-timeline] could not draw the timeline as a picture', { error: (err as Error)?.message });
    return null;
  }
}

/**
 * For email: replace the inline SVG between the markers with <img src="cid:…"> and return the
 * PNG to attach inline. If the picture can't be made, the block becomes a one-line note.
 */
export async function timelineForEmail(html: string): Promise<{ html: string; attachments: Array<{ filename: string; content: string; contentId: string; contentType: string }> }> {
  const a = html.indexOf(TIMELINE_START);
  const b = html.indexOf(TIMELINE_END);
  if (a === -1 || b === -1 || b < a) return { html, attachments: [] };
  const block = html.slice(a + TIMELINE_START.length, b);
  const svg = block.match(/<svg[\s\S]*<\/svg>/)?.[0];
  const png = svg ? await svgToPng(svg) : null;
  const replacement = png
    ? `<img src="cid:${TIMELINE_CID}" alt="Project timeline" width="760" style="display:block; width:100%; max-width:760px; height:auto; border:1px solid #e5e7eb;" />`
    : '<p style="color:#6b7280; font-size:12px; margin:0;">The schedule timeline is shown in the report in Kovarti.</p>';
  return {
    html: html.slice(0, a) + replacement + html.slice(b + TIMELINE_END.length),
    attachments: png ? [{ filename: 'timeline.png', content: png.toString('base64'), contentId: TIMELINE_CID, contentType: 'image/png' }] : [],
  };
}
