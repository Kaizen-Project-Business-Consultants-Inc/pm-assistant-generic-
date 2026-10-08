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
 * For email: replace each inline SVG between the markers with <img src="cid:…"> and return the
 * PNGs to attach inline (a client report has one timeline per project). If a picture can't be
 * made, that block becomes a one-line note.
 */
export async function timelineForEmail(html: string): Promise<{ html: string; attachments: Array<{ filename: string; content: string; contentId: string; contentType: string }> }> {
  const attachments: Array<{ filename: string; content: string; contentId: string; contentType: string }> = [];
  let out = '';
  let rest = html;
  for (let n = 0; n < 50; n++) {
    const a = rest.indexOf(TIMELINE_START);
    const b = a === -1 ? -1 : rest.indexOf(TIMELINE_END, a);
    if (a === -1 || b === -1) break;
    const svg = rest.slice(a + TIMELINE_START.length, b).match(/<svg[\s\S]*<\/svg>/)?.[0];
    // eslint-disable-next-line no-await-in-loop -- SVG-to-PNG rendering is CPU and memory heavy; one picture at a time
    const png = svg ? await svgToPng(svg) : null;
    const cid = n === 0 ? TIMELINE_CID : `${TIMELINE_CID}-${n + 1}`;
    out += rest.slice(0, a) + (png
      ? `<img src="cid:${cid}" alt="Project timeline" width="760" style="display:block; width:100%; max-width:760px; height:auto; border:1px solid #e5e7eb;" />`
      : '<p style="color:#6b7280; font-size:12px; margin:0;">The schedule timeline is shown in the report in Kovarti.</p>');
    if (png) attachments.push({ filename: `timeline${n ? `-${n + 1}` : ''}.png`, content: png.toString('base64'), contentId: cid, contentType: 'image/png' });
    rest = rest.slice(b + TIMELINE_END.length);
  }
  return { html: out + rest, attachments };
}
