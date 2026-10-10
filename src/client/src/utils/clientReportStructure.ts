/**
 * Gives the client report preview real structure for screen readers (audit 2 H5).
 *
 * The server sends the report as email-safe HTML: the title sits in a layout table and the
 * section titles ("1. SUMMARY ACROSS ALL PROJECTS" …) are styled <p>s, so a screen-reader user
 * had no headings to move between. Here, on the already-sanitised HTML, the report title becomes
 * an <h2>, each numbered section title an <h3> and each project label above a timeline an <h4>
 * (the page's own <h1> is "Client report — <client>"). Inline styles are kept, so it looks the
 * same. The title's layout table is marked role="presentation", and the faint footer grey
 * (#9ca3af, 2.5:1 at 10px) is darkened to #6b7280 (4.8:1).
 */

const NAVY = '#283480';
const FAINT_FOOTER = /color:\s*#9ca3af/i;

function rename(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag);
  for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.replaceWith(next);
  return next;
}

export function structureClientReport(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<div id="client-report-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('client-report-root');
  if (!root) return html;

  // The title block: a one-cell layout table holding the big title line
  const titleTable = root.querySelector('table');
  const titleCell = titleTable?.querySelector('td');
  const titleLine = titleCell?.querySelector('p');
  if (titleTable && titleLine && !titleTable.querySelector('th') && /font-size:\s*18px/i.test(titleLine.getAttribute('style') ?? '')) {
    titleTable.setAttribute('role', 'presentation');
    rename(titleLine, 'h2');
  }

  for (const p of Array.from(root.querySelectorAll('p'))) {
    const style = p.getAttribute('style') ?? '';
    if (style.toLowerCase().includes(`color: ${NAVY}`) && /font-weight:\s*700/i.test(style)) {
      rename(p, 'h3'); // numbered section title
    } else if (/font-weight:\s*600/i.test(style) && /color:\s*#374151/i.test(style)) {
      rename(p, 'h4'); // project label above its timeline
    } else if (FAINT_FOOTER.test(style)) {
      p.setAttribute('style', style.replace(FAINT_FOOTER, 'color: #6b7280'));
    }
  }
  return root.innerHTML;
}
