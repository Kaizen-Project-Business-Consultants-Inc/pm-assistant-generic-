import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FullUserGuidePage } from '../../pages/FullUserGuidePage';
import guideMarkdown from '../../../../../docs/USER_GUIDE.md?raw';
import { splitUserGuide, findGuideAnchor } from '../../utils/userGuide';
import { useAuthStore } from '../../stores/authStore';

// happy-dom's DOMPurify drops <h2> (a test-DOM quirk; browsers keep it) — sanitising isn't under test here
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));

/**
 * The in-app guide reader (/help/guide) follows a #link to a sub-heading (2026-10-08): it opens the
 * chapter that holds the heading, scrolls there and moves focus to it. It used to open chapter 1.
 */
const article = () => document.getElementById('guide-chapter')!;
const chapterTitle = () => article().querySelector('h2')?.textContent;

function show(hash: string) {
  window.history.replaceState(null, '', `/help/guide${hash}`);
  return render(<MemoryRouter><FullUserGuidePage /></MemoryRouter>);
}

describe('FullUserGuidePage #links', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    useAuthStore.setState({ user: null });
  });

  it('a malformed address (#%E0) opens chapter 1 instead of crashing', () => {
    show('#%E0');
    expect(chapterTitle()).toBe('1. Getting Started');
  });

  it('opening the guide at a sub-heading shows its chapter and focuses the heading', () => {
    show('#rate-card');
    expect(chapterTitle()).toBe('8. Resources');
    const heading = document.getElementById('rate-card');
    expect(heading?.textContent).toBe('Rate Card');
    expect(document.activeElement).toBe(heading);
    expect(heading?.scrollIntoView).toHaveBeenCalled();
  });

  it('following an in-text link to a heading in another chapter moves there', () => {
    show('#1-getting-started');
    expect(chapterTitle()).toBe('1. Getting Started');
    act(() => {
      window.location.hash = '#viewer-invites';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(chapterTitle()).toBe('22. Settings and Account');
    expect(document.activeElement).toBe(document.getElementById('viewer-invites'));
  });

  it('a chapter link opens the chapter and focuses its title', () => {
    show('#1-getting-started');
    act(() => {
      window.location.hash = '#31-raid-log';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(chapterTitle()).toBe('31. RAID Log');
    expect(document.activeElement).toBe(article().querySelector('h2'));
  });

  it.each(['admin', 'team_member'])('as %s, every sub-heading of every chapter gets its id on the page', role => {
    useAuthStore.setState({ user: { id: 'u1', role } as never });
    for (const c of splitUserGuide(guideMarkdown, role)) {
      const { unmount } = show(`#${c.id}`);
      const missing = c.headingIds.filter(id => !article().querySelector(`[id="${id}"]`));
      expect(missing, `chapter ${c.title}`).toEqual([]);
      unmount();
    }
  });

  it("GitHub's chapter ids work too, and repeated headings are numbered as on GitHub", () => {
    const chapters = splitUserGuide(guideMarkdown, 'admin');
    expect(findGuideAnchor(chapters, '30-dashboard--projects')?.chapterId).toBe('30-dashboard-projects');
    const notif = chapters.flatMap(c => c.headingIds).filter(id => /^notifications(-\d+)?$/.test(id));
    expect(notif).toEqual(['notifications', 'notifications-1', 'notifications-2']);
    // a team member doesn't see admin-only parts, but the ids they do see are the same
    const team = splitUserGuide(guideMarkdown, 'team_member').flatMap(c => c.headingIds);
    const all = new Set(chapters.flatMap(c => c.headingIds));
    expect(team.filter(id => !all.has(id))).toEqual([]);
  });

  it('an unknown id leaves the reader where it is', () => {
    show('#31-raid-log');
    act(() => {
      window.location.hash = '#no-such-heading';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(chapterTitle()).toBe('31. RAID Log');
  });
});
