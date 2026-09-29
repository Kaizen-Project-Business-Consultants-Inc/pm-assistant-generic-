/**
 * The full user guide (docs/USER_GUIDE.md — the same file updated with every change) split into
 * its numbered chapters for the in-app reader. Admin-only parts ("### … (Admin Only)",
 * "### … (Admin/Manager)") are left out for people who can't use them.
 */

export interface GuideChapter {
  id: string;
  title: string;
  markdown: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Drop "### …Admin…" subsections (heading to the next ### or ##) the reader can't use */
function withoutAdminParts(md: string, role: string | undefined): string {
  const isAdmin = role === 'admin';
  const isManager = isAdmin || role === 'project_manager' || role === 'pmo';
  const out: string[] = [];
  let skipping = false;
  for (const line of md.split('\n')) {
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) {
      const title = h3[1];
      const adminOnly = /\badmin only\b/i.test(title) || /\(admin\)/i.test(title);
      const adminOrManager = /\(admin\s*\/\s*manager\)/i.test(title);
      skipping = (adminOnly && !isAdmin) || (adminOrManager && !isManager);
    } else if (/^##\s/.test(line)) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

export function splitUserGuide(md: string, role?: string): GuideChapter[] {
  const chapters: GuideChapter[] = [];
  const parts = md.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  for (const part of parts) {
    const m = /^## (.+)\n/.exec(part);
    if (!m) continue; // the title block above the first chapter
    const title = m[1].trim();
    if (/^table of contents$/i.test(title)) continue; // the reader builds its own
    chapters.push({ id: slug(title), title, markdown: withoutAdminParts(part, role) });
  }
  return chapters;
}

/** Chapters whose title or text contains every word of the search */
export function searchGuide(chapters: GuideChapter[], query: string): GuideChapter[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return chapters;
  return chapters.filter(c => {
    const text = `${c.title}\n${c.markdown}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
}
