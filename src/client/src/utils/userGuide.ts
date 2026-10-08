/**
 * The full user guide (docs/USER_GUIDE.md — the same file updated with every change) split into
 * its numbered chapters for the in-app reader. Admin-only parts ("### … (Admin Only)",
 * "### … (Admin/Manager)") are left out for people who can't use them.
 */

import { marked, type Token } from 'marked';

export interface GuideChapter {
  id: string;
  title: string;
  markdown: string;
  /** Ids of the chapter's sub-headings (### and deeper), in order — the ids GitHub gives them,
   *  so a link like #rate-card works both on GitHub and in the app */
  headingIds: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Drop "### …Admin…" subsections (heading to the next ### or ##) the reader can't use */
function withoutAdminParts(md: string, role: string | undefined): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of md.split('\n')) {
    const h3 = /^###\s+(.*)$/.exec(line);
    if (h3) skipping = hiddenFor(h3[1], role);
    else if (/^##\s/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/** Is a "### " section one this reader can't use? ("(Admin Only)", "(Admin)", "(Admin/Manager)") */
function hiddenFor(title: string, role: string | undefined): boolean {
  const isAdmin = role === 'admin';
  const isManager = isAdmin || role === 'project_manager' || role === 'pmo';
  const adminOnly = /\badmin only\b/i.test(title) || /\(admin\)/i.test(title);
  const adminOrManager = /\(admin\s*\/\s*manager\)/i.test(title);
  return (adminOnly && !isAdmin) || (adminOrManager && !isManager);
}

/** GitHub's heading id (github-slugger): lower case, punctuation dropped, each space a hyphen */
export const githubSlug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');

/** A heading's visible text, from the markdown parser's inline tokens (no regex parsing); inline
 *  HTML tags are left out, as GitHub does */
const plainText = (tokens: Token[]): string =>
  tokens.map(t => (t.type === 'html' ? '' : 'tokens' in t && t.tokens ? plainText(t.tokens) : 'text' in t ? String(t.text) : '')).join('');

/**
 * A part's headings in document order, each with GitHub's id (the base id, then -1, -2… for
 * repeats anywhere in the file — `used` is shared by the whole file) and whether this reader sees
 * it (withoutAdminParts' rule, applied to the heading list).
 */
function headingsOf(markdown: string, used: Map<string, number>, role: string | undefined) {
  const out: Array<{ depth: number; id: string; shown: boolean }> = [];
  let hiding = false;
  void marked.walkTokens(marked.lexer(markdown), t => {
    if (t.type !== 'heading') return;
    const text = plainText(t.tokens ?? []);
    if (t.depth === 3) hiding = hiddenFor(t.text, role);
    else if (t.depth <= 2) hiding = false;
    const base = githubSlug(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    out.push({ depth: t.depth, id: n ? `${base}-${n}` : base, shown: !hiding });
  });
  return out;
}

export function splitUserGuide(md: string, role?: string): GuideChapter[] {
  const chapters: GuideChapter[] = [];
  const used = new Map<string, number>(); // shared by the whole file, as on GitHub
  const parts = md.replace(/\r\n/g, '\n').split(/^(?=## )/m);
  for (const part of parts) {
    // ids are counted over the whole file (title block, contents list and admin-only parts too),
    // so they match GitHub's for every reader
    const headings = headingsOf(part, used, role);
    const m = /^## (.+)\n/.exec(part);
    if (!m) continue; // the title block above the first chapter
    const title = m[1].trim();
    if (/^table of contents$/i.test(title)) continue; // the reader builds its own
    const markdown = withoutAdminParts(part, role);
    // the reader's sub-headings in the order shown; the page gives them these ids by position
    // eslint-disable-next-line no-restricted-syntax -- small: one pass over this chapter's own headings, not a search
    const headingIds = headings.filter(h => h.shown && h.depth >= 3).map(h => h.id);
    chapters.push({ id: slug(title), title, markdown, headingIds });
  }
  return chapters;
}

/**
 * Where a #link in the guide goes: a chapter id opens that chapter; a sub-heading id opens the
 * chapter that contains the heading and names the heading to scroll to. Unknown → null.
 */
export function findGuideAnchor(chapters: GuideChapter[], id: string): { chapterId: string; headingId?: string } | null {
  if (!id) return null;
  // a chapter by the app's id or GitHub's (#30-dashboard--projects)
  const chapter = chapters.find(c => c.id === id || githubSlug(c.title) === id);
  if (chapter) return { chapterId: chapter.id };
  const c = chapters.find(ch => ch.headingIds.includes(id));
  return c ? { chapterId: c.id, headingId: id } : null;
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
