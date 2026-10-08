import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { splitUserGuide } from '../../utils/userGuide';
import { UserGuideContent } from '../../pages/UserGuidePage';

/**
 * Guide links land where they say (2026-10-08).
 *
 * The full guide (docs/USER_GUIDE.md) is read in the app at /help/guide. The reader shows one
 * chapter ("## " heading) at a time and treats a #link as a CHAPTER id; any other id falls back
 * to chapter 1 — so a link to a sub-heading quietly opens the wrong page. Its own contents list
 * ("## Table of Contents") is dropped in the app, so that list is only read on GitHub, where ids
 * are GitHub's heading slugs.
 *
 * Known breakages are allowed below, each with a reason. The lists can only shrink: an entry
 * that works again fails the test until it is removed.
 */
const ALLOWED: Record<string, string> = {
  // In-text links that point at a sub-heading, not a chapter (open chapter 1 in the app)
  'text:#working-calendar-and-company-holidays': 'KNOWN — efficiency report: sub-heading of 22, not a chapter',
  'text:#slack-setup': 'KNOWN — efficiency report: sub-heading, not a chapter',
  'text:#viewer-invites': 'KNOWN — efficiency report: sub-heading, not a chapter',
  'text:#rate-card': 'KNOWN — efficiency report: sub-heading, not a chapter',
  'text:#clients-october-2026': 'KNOWN — efficiency report: sub-heading, not a chapter',
  // Contents list: wrong targets
  'toc:#29-dashboard-widget-drag-to-reorder': 'KNOWN — efficiency report: chapter 29 is now "Dashboard Widget Customization"',
  'toc:#32-scrum-enhancements': 'KNOWN — efficiency report: Scrum Enhancements is chapter 33',
  // Contents list: numbered chapters it leaves out
  'toc-missing:33-scrum-enhancements': 'KNOWN — efficiency report: not in the contents list',
  'toc-missing:36-cookie-consent-analytics': 'KNOWN — efficiency report: not in the contents list',
  'toc-missing:37-product-roadmap': 'KNOWN — efficiency report: not in the contents list',
  'toc-missing:39-automation-engine': 'KNOWN — efficiency report: not in the contents list',
  'toc-missing:40-document-intelligence': 'KNOWN — efficiency report: not in the contents list',
  'toc-missing:29-dashboard-widget-customization': 'FOUND by guide-link test 2026-10-08: listed under its old name (see toc:#29-…)',
  'toc-missing:26b-resource-management-enhancements': 'FOUND by guide-link test 2026-10-08: not in the contents list',
};

const guide = readFileSync(join(__dirname, '../../../../../docs/USER_GUIDE.md'), 'utf-8').replace(/\r\n/g, '\n');

/** GitHub's heading id (github-slugger): lower case, punctuation dropped, each space a hyphen */
const githubSlug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');

function guideProblems(): string[] {
  const problems = new Set<string>();
  const chapters = splitUserGuide(guide, 'admin');
  const chapterIds = new Set(chapters.map(c => c.id));

  const tocStart = guide.indexOf('## Table of Contents\n');
  const tocEnd = guide.indexOf('\n## ', tocStart + 1);
  const toc = guide.slice(tocStart, tocEnd);
  const body = guide.slice(0, tocStart) + guide.slice(tocEnd);

  // 1. Links in the text, as the in-app reader resolves them: chapter ids only
  for (const m of body.matchAll(/\]\(#([^)\s]+)\)/g)) {
    const id = decodeURIComponent(m[1]);
    if (!chapterIds.has(id)) problems.add(`text:#${id}`);
  }

  // 2. Contents list, as GitHub resolves it: the "## " headings' GitHub ids
  const githubIds = new Set([...guide.matchAll(/^## (.+)$/gm)].map(m => githubSlug(m[1])));
  const linked = new Set<string>();
  for (const m of toc.matchAll(/\]\(#([^)\s]+)\)/g)) {
    linked.add(m[1]);
    if (!githubIds.has(m[1])) problems.add(`toc:#${m[1]}`);
  }

  // 3. Every numbered chapter is in the contents list
  for (const m of guide.matchAll(/^## (\d.*)$/gm)) {
    if (!linked.has(githubSlug(m[1]))) problems.add(`toc-missing:${splitUserGuide(`## ${m[1]}\n`)[0].id}`);
  }
  return [...problems].sort();
}

describe('docs/USER_GUIDE.md links (in-app reader /help/guide)', () => {
  const problems = guideProblems();

  it('has no broken #links beyond the allow-list', () => {
    expect(problems.filter(p => !(p in ALLOWED)), 'new broken guide link — fix the link (do not allow-list it)').toEqual([]);
  });

  it('allow-list only shrinks: every entry is still broken', () => {
    const found = new Set(problems);
    const fixed = Object.keys(ALLOWED).filter(k => !found.has(k));
    expect(fixed, 'these work now — remove them from the allow-list').toEqual([]);
  });

  it('really does find links (the scan is not silently empty)', () => {
    expect(splitUserGuide(guide).length).toBeGreaterThan(30);
    expect(guide.match(/\]\(#[^)]+\)/g)?.length ?? 0).toBeGreaterThan(30);
  });
});

describe('in-app quick guide (/help) contents list', () => {
  afterEach(cleanup);

  it('every contents link has a section with that id, and ids are unique', () => {
    const { container } = render(<MemoryRouter><UserGuideContent showFullGuideLink /></MemoryRouter>);
    const hrefs = [...container.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')!.slice(1));
    const ids = [...container.querySelectorAll('[id]')].map(e => e.id);
    expect(hrefs.length).toBeGreaterThan(20);
    const idSet = new Set(ids);
    const hrefSet = new Set(hrefs);
    expect(hrefs.filter(h => !idSet.has(h)), 'contents links with no matching section').toEqual([]);
    expect(idSet.size, 'duplicate section ids').toBe(ids.length);
    const sections = [...container.querySelectorAll('section[id]')].map(s => s.id);
    expect(sections.filter(s => !hrefSet.has(s)), 'sections missing from the contents list').toEqual([]);
  });
});
