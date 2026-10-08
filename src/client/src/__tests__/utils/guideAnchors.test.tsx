import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { splitUserGuide, findGuideAnchor, githubSlug } from '../../utils/userGuide';
import { UserGuideContent } from '../../pages/UserGuidePage';

/**
 * Guide links land where they say (2026-10-08).
 *
 * The full guide (docs/USER_GUIDE.md) is read in the app at /help/guide. The reader shows one
 * chapter ("## " heading) at a time; a #link may name a chapter or a sub-heading, which opens the
 * chapter holding it and scrolls there (findGuideAnchor). The ids are GitHub's heading ids, so the
 * same links work on GitHub. The guide's own contents list ("## Table of Contents") is dropped in
 * the app, so that list is only read on GitHub.
 *
 * Known breakages may be allowed below, each with a reason. The list can only shrink: an entry
 * that works again fails the test until it is removed. (Emptied 2026-10-08.)
 */
const ALLOWED: Record<string, string> = {};

const guide = readFileSync(join(__dirname, '../../../../../docs/USER_GUIDE.md'), 'utf-8').replace(/\r\n/g, '\n');

function guideProblems(): string[] {
  const problems = new Set<string>();
  const chapters = splitUserGuide(guide, 'admin');

  const tocStart = guide.indexOf('## Table of Contents\n');
  const tocEnd = guide.indexOf('\n## ', tocStart + 1);
  const toc = guide.slice(tocStart, tocEnd);
  const body = guide.slice(0, tocStart) + guide.slice(tocEnd);

  // GitHub's ids for the chapters ("## " headings)
  const githubIds = new Set([...guide.matchAll(/^## (.+)$/gm)].map(m => githubSlug(m[1])));

  // 1. Links in the text: the in-app reader finds them (chapter or sub-heading), and so does GitHub
  for (const m of body.matchAll(/\]\(#([^)\s]+)\)/g)) {
    const id = decodeURIComponent(m[1]);
    if (!findGuideAnchor(chapters, id)) problems.add(`text:#${id}`);
    if (!githubIds.has(id) && !chapters.some(c => c.headingIds.includes(id))) problems.add(`text-github:#${id}`);
  }

  // 2. Contents list, as GitHub resolves it: the chapters' GitHub ids
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
