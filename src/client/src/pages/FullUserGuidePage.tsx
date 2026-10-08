import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { BookOpen, Search, ArrowLeft } from 'lucide-react';
// The same file that is updated with every change — one guide, never a second copy
import guideMarkdown from '../../../../docs/USER_GUIDE.md?raw';
import { renderMarkdown } from '../utils/renderMarkdown';
import { splitUserGuide, searchGuide, findGuideAnchor } from '../utils/userGuide';
import { useAuthStore } from '../stores/authStore';

/** The #id in the address; '' when there is none or it is malformed (e.g. #%E0) */
const idFromHash = () => {
  if (typeof window === 'undefined') return '';
  try { return decodeURIComponent(window.location.hash.replace(/^#/, '')); } catch { return ''; }
};

/** Where a #link should land: a heading in the shown chapter (none = the chapter title). Set when
 *  the address's #id changes; following the same link again only gets the browser's own jump. */
interface Landing { headingId?: string }

/**
 * The complete user guide inside the app: chapter list, search, one chapter at a time.
 * A #link may name a chapter or any sub-heading in it (#rate-card): the reader opens the chapter
 * that holds it, scrolls to the heading and moves keyboard / screen-reader focus there.
 */
export function FullUserGuidePage() {
  const role = useAuthStore((s) => s.user?.role);
  const chapters = useMemo(() => splitUserGuide(guideMarkdown, role), [role]);
  const [query, setQuery] = useState('');
  const [initial] = useState(() => findGuideAnchor(chapters, idFromHash()));
  const [activeId, setActiveId] = useState(() => initial?.chapterId || chapters[0]?.id || '');
  const [landing, setLanding] = useState<Landing | null>(() => (initial?.headingId ? { headingId: initial.headingId } : null));
  const articleRef = useRef<HTMLElement>(null);

  const shown = useMemo(() => searchGuide(chapters, query), [chapters, query]);
  const active = chapters.find(c => c.id === activeId) ?? chapters[0];
  const html = useMemo(() => (active ? DOMPurify.sanitize(renderMarkdown(active.markdown)) : ''), [active]);

  useEffect(() => {
    const onHash = () => {
      const target = findGuideAnchor(chapters, idFromHash());
      if (!target) return;
      setActiveId(target.chapterId);
      setLanding({ headingId: target.headingId });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [chapters]);

  // Give the shown chapter's sub-headings their ids, so links to them work. The page and the ids
  // come from the same markdown and parser, so they pair up by position; if the counts ever differ
  // (e.g. a raw HTML heading in the guide) no ids are set, and the guide test fails.
  useEffect(() => {
    const ids = active?.headingIds ?? [];
    const headings = articleRef.current?.querySelectorAll('h3, h4, h5, h6');
    if (!headings || headings.length !== ids.length) return;
    headings.forEach((h, i) => { h.id = ids[i]; });
  }, [html, active]);

  // Land on the linked heading (or the chapter title): scroll to it and move focus there
  useEffect(() => {
    if (!landing) return;
    setLanding(null);
    const article = articleRef.current;
    const el = landing.headingId ? article?.querySelector(`[id="${CSS.escape(landing.headingId)}"]`) : article?.querySelector('h2');
    if (!(el instanceof HTMLElement)) return;
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [landing, html]);

  const open = (id: string) => {
    setActiveId(id);
    setLanding(null);
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    document.getElementById('guide-chapter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Full User Guide</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Every feature in detail — kept up to date with each release.</p>
          </div>
        </div>
        <Link to="/help" className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:underline">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Quick guide
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <nav aria-label="User guide chapters" className="lg:sticky lg:top-4 lg:self-start">
          <label className="relative block mb-3">
            <span className="sr-only">Search the guide</span>
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide…"
              className="input w-full pl-8 text-sm"
            />
          </label>
          <ol className="max-h-[70vh] overflow-y-auto space-y-0.5 pr-1">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={c.id === active?.id ? 'page' : undefined}
                  className={`w-full text-left text-sm px-2.5 py-1.5 rounded-md ${c.id === active?.id ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                >
                  {c.title}
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="text-sm text-gray-500 dark:text-gray-400 px-2.5 py-1.5">Nothing matches “{query}”.</li>}
          </ol>
        </nav>

        <article
          ref={articleRef}
          id="guide-chapter"
          className="prose max-w-none min-w-0 overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 md:p-8 scroll-mt-4 [&_h2]:scroll-mt-20 [&_h3]:scroll-mt-20 [&_h4]:scroll-mt-20"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
