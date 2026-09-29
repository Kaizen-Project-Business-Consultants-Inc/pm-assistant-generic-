import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { BookOpen, Search, ArrowLeft } from 'lucide-react';
// The same file that is updated with every change — one guide, never a second copy
import guideMarkdown from '../../../../docs/USER_GUIDE.md?raw';
import { renderMarkdown } from '../utils/renderMarkdown';
import { splitUserGuide, searchGuide } from '../utils/userGuide';
import { useAuthStore } from '../stores/authStore';

const chapterFromHash = () => (typeof window !== 'undefined' ? decodeURIComponent(window.location.hash.replace(/^#/, '')) : '');

/** The complete user guide inside the app: chapter list, search, one chapter at a time. */
export function FullUserGuidePage() {
  const role = useAuthStore((s) => s.user?.role);
  const chapters = useMemo(() => splitUserGuide(guideMarkdown, role), [role]);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(() => chapterFromHash() || chapters[0]?.id || '');

  const shown = useMemo(() => searchGuide(chapters, query), [chapters, query]);
  const active = chapters.find(c => c.id === activeId) ?? chapters[0];
  const html = useMemo(() => (active ? DOMPurify.sanitize(renderMarkdown(active.markdown)) : ''), [active]);

  useEffect(() => {
    const onHash = () => { const id = chapterFromHash(); if (id) setActiveId(id); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const open = (id: string) => {
    setActiveId(id);
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
          id="guide-chapter"
          className="prose max-w-none min-w-0 overflow-x-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5 md:p-8 scroll-mt-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
