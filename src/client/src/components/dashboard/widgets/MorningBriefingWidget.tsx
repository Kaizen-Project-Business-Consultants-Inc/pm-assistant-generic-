import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sun, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate } from '../../../utils/dateUtils';
import {
  buildProjectBriefings, statusSummary,
  type ProjectBriefing, type BriefingSection, type BriefingItem, type ItemTone, type BriefingLevel,
} from '../../../utils/briefingByProject';

const FLASH_KEY = 'briefing-last-flash';
const FLASH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const VIEW_KEY = 'briefing-view';
/** Items per section: a single project has room for more than the all-projects page */
const ITEMS_ONE = 6;
const ITEMS_ALL = 3;

// Global roles that see the resource (assigned person) column
const MANAGER_ROLES = ['admin', 'pmo', 'executive', 'project_manager', 'scrum_master'];

const TONE_CLASSES: Record<ItemTone, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const LEVEL_DOT: Record<BriefingLevel, string> = {
  red: 'bg-red-500', amber: 'bg-amber-500', green: 'bg-emerald-500',
};
const LEVEL_PILL: Record<BriefingLevel, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};
const LEVEL_LABEL: Record<BriefingLevel, string> = {
  red: 'Needs you today', amber: 'Something waiting', green: 'On track',
};
const SECTION_COLOUR: Record<BriefingSection['key'], string> = {
  late: 'text-red-700 dark:text-red-400',
  blocked: 'text-orange-700 dark:text-orange-400',
  risks: 'text-red-700 dark:text-red-400',
  approvals: 'text-amber-700 dark:text-amber-400',
  due: 'text-blue-700 dark:text-blue-400',
};

const shortDate = (d: string) => formatCalendarDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) || d;

interface Props {
  scope?: 'portfolio';
}

export function MorningBriefingWidget({ scope }: Props) {
  const user = useAuthStore(s => s.user);
  const isViewer = user?.role === 'viewer';
  const showResource = MANAGER_ROLES.includes(user?.role ?? '');

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('briefing-collapsed') === 'true'; } catch { return false; }
  });
  // "All projects" by default: every client visible at once, nothing hidden behind a click
  const [view, setView] = useState<'all' | 'one'>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'one' ? 'one' : 'all'; } catch { return 'all'; }
  });
  // Not remembered: each morning opens on the project that needs you most
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Flash once per 24 hours on first load
  const [shouldFlash, setShouldFlash] = useState(false);
  const flashChecked = useRef(false);
  useEffect(() => {
    if (flashChecked.current) return;
    flashChecked.current = true;
    try {
      const lastFlash = localStorage.getItem(FLASH_KEY);
      const now = Date.now();
      if (!lastFlash || now - Number(lastFlash) >= FLASH_INTERVAL_MS) {
        setShouldFlash(true);
        localStorage.setItem(FLASH_KEY, String(now));
        const timer = setTimeout(() => setShouldFlash(false), 2000);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, []);

  const { data: briefingRaw, isLoading } = useQuery({
    queryKey: ['daily-briefing', scope],
    queryFn: () => apiService.getDailyBriefing(scope),
    staleTime: 120_000,
  });
  const briefing = briefingRaw?.data ?? briefingRaw;

  const projects = useMemo<ProjectBriefing[]>(
    () => (briefing ? buildProjectBriefings(briefing, { showApprovals: !isViewer, formatDate: shortDate }) : []),
    [briefing, isViewer],
  );
  const selected = projects.find(p => p.id === selectedId) ?? projects[0];

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('briefing-collapsed', String(next)); } catch { /* noop */ }
  };
  const chooseView = (v: 'all' | 'one') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* noop */ }
  };

  const listRef = useRef<HTMLDivElement>(null);
  const onListKey = useCallback((e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || projects.length === 0) return;
    e.preventDefault();
    const i = Math.max(0, projects.findIndex(p => p.id === selected?.id));
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? projects.length - 1
      : (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? Math.min(i + 1, projects.length - 1) : Math.max(i - 1, 0);
    setSelectedId(projects[n].id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-project-id="${projects[n].id}"]`)?.focus();
  }, [projects, selected?.id]);

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 animate-pulse motion-reduce:animate-none">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
          <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded-lg" />
          <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Morning Briefing</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No briefing data available.</p>
      </div>
    );
  }

  const pendingProposals = briefing.actionItems?.pendingProposals ?? 0;
  const unreadTotal = briefing.actionItems?.unreadNotifications?.total ?? 0;
  const unreadCritical = briefing.actionItems?.unreadNotifications?.critical ?? 0;
  const unreadHigh = briefing.actionItems?.unreadNotifications?.high ?? 0;

  const renderItem = (item: BriefingItem) => {
    const second = [
      item.rowNum != null ? `Row ${item.rowNum}` : '',
      item.extra ?? '',
      showResource && item.resourceName ? `Owner: ${item.resourceName}` : '',
    ].filter(Boolean).join(' · ');
    return (
      <li key={item.id}>
        <Link
          to={item.link}
          className="block -mx-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 group"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-primary-700 dark:group-hover:text-primary-300 group-hover:underline" title={item.label}>{item.label}</span>
            {item.tag && <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${TONE_CLASSES[item.tone]}`}>{item.tag}</span>}
          </div>
          {second && <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={second}>{second}</div>}
        </Link>
      </li>
    );
  };

  const renderSection = (s: BriefingSection, max: number) => (
    <div key={s.key}>
      <h4 className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${SECTION_COLOUR[s.key]}`}>
        {s.title} <span className="font-medium text-gray-500 dark:text-gray-400 tabular-nums">({s.count})</span>
      </h4>
      {s.count === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">None</p>
      ) : (
        <ul className="space-y-0.5">
          {s.items.slice(0, max).map(renderItem)}
          {s.count > Math.min(max, s.items.length) && (
            <li className="pt-1">
              <Link to={s.moreLink} className="text-xs font-medium text-primary-700 dark:text-primary-300 hover:underline">
                See all {s.count} →
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );

  const projectHeader = (p: ProjectBriefing, big: boolean) => {
    const summary = statusSummary(p);
    return (
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h4 className={`${big ? 'text-base' : 'text-sm'} font-bold text-gray-900 dark:text-gray-100`}>{p.name}</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {[p.subtitle, p.nextMilestone ? `Next milestone: ${p.nextMilestone.name}, ${shortDate(p.nextMilestone.dueDate)}` : ''].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${LEVEL_PILL[p.level]}`}>
            {LEVEL_LABEL[p.level]}{summary ? ` · ${summary}` : ''}
          </span>
          <Link to={`/project/${p.id}`} className="text-sm font-semibold text-primary-700 dark:text-primary-300 hover:underline whitespace-nowrap">
            Open project →
          </Link>
        </div>
      </div>
    );
  };

  const projectBody = (p: ProjectBriefing, max: number) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 mt-3">
      {p.sections.map(s => renderSection(s, max))}
    </div>
  );

  const chip = (text: string, cls: string) => <span className={`text-[11px] font-semibold px-1.5 py-px rounded-full whitespace-nowrap ${cls}`}>{text}</span>;
  const listChips = (p: ProjectBriefing) => {
    const out: JSX.Element[] = [];
    for (const s of p.sections) {
      if (s.count === 0) continue;
      if (s.key === 'late') out.push(<span key="l">{chip(`${s.count} late`, TONE_CLASSES.red)}</span>);
      if (s.key === 'blocked') out.push(<span key="b">{chip(`${s.count} blocked`, TONE_CLASSES.orange)}</span>);
      if (s.key === 'risks') out.push(<span key="r">{chip(`${s.count} risk`, TONE_CLASSES.red)}</span>);
      if (s.key === 'approvals') out.push(<span key="a">{chip(`${s.count} approval`, TONE_CLASSES.amber)}</span>);
      if (s.key === 'due') out.push(<span key="d">{chip(`${s.count} due`, TONE_CLASSES.blue)}</span>);
    }
    return out.length ? out : [<span key="q" className="text-xs text-gray-500 dark:text-gray-400">Nothing needs you</span>];
  };

  const busy = projects.filter(p => !p.quiet);
  const quiet = projects.filter(p => p.quiet);

  const viewSwitch = (
    <div role="group" aria-label="Briefing view" className="inline-flex rounded-lg border border-primary-600 dark:border-primary-400 overflow-hidden">
      {([['all', 'All projects'], ['one', 'One project at a time']] as const).map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => chooseView(v)}
          className={`px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${
            view === v ? 'bg-primary-600 text-white dark:bg-primary-500' : 'text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden${shouldFlash ? ' animate-briefing-flash motion-reduce:animate-none' : ''}`}>
      {/* Header */}
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Morning Briefing</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{today}</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" /> : <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden="true" />}
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {/* View switch + things that belong to no single project */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
            {viewSwitch}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
              {unreadTotal > 0 && (
                <Link to="/notifications" className="hover:underline">
                  <span className="font-semibold tabular-nums">{unreadTotal}</span> unread notification{unreadTotal !== 1 ? 's' : ''}
                  {(unreadCritical > 0 || unreadHigh > 0) && (
                    <span className="text-gray-500 dark:text-gray-400">{' '}({[unreadCritical ? `${unreadCritical} critical` : '', unreadHigh ? `${unreadHigh} high` : ''].filter(Boolean).join(', ')})</span>
                  )}
                </Link>
              )}
              {!isViewer && pendingProposals > 0 && (
                <Link to="/agent" className="hover:underline"><span className="font-semibold tabular-nums">{pendingProposals}</span> agent proposal{pendingProposals !== 1 ? 's' : ''} to review</Link>
              )}
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">You have no active projects yet.</p>
          ) : view === 'all' ? (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {busy.map(p => (
                <section key={p.id} aria-label={p.name} className="px-4 py-4">
                  {projectHeader(p, false)}
                  {projectBody(p, ITEMS_ALL)}
                </section>
              ))}
              {quiet.length > 0 && (
                <section aria-label="Quiet projects" className="px-4 py-4">
                  <h4 className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-2">
                    Quiet: nothing needs you <span className="font-medium text-gray-500 dark:text-gray-400">({quiet.length})</span>
                  </h4>
                  <ul className="space-y-1">
                    {quiet.map(p => (
                      <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-md bg-gray-50 dark:bg-gray-900/40 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
                          <span className={`w-2 h-2 rounded-full ${LEVEL_DOT.green}`} aria-hidden="true" />
                          {p.name}
                          {p.code && <span className="text-xs text-gray-500 dark:text-gray-400 font-normal">{p.code}</span>}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {p.nextMilestone ? `Next milestone: ${p.nextMilestone.name}, ${shortDate(p.nextMilestone.dueDate)} · ` : ''}
                          <Link to={`/project/${p.id}`} className="font-semibold text-primary-700 dark:text-primary-300 hover:underline">Open →</Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr]">
              {/* Project list — never hides a project; colour and counts show who needs you */}
              <div
                ref={listRef}
                role="tablist"
                aria-label="Your projects"
                aria-orientation="vertical"
                onKeyDown={onListKey}
                className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible md:max-h-[32rem] md:overflow-y-auto p-2 bg-gray-50 dark:bg-gray-900/40 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700"
              >
                {projects.map(p => {
                  const isSel = p.id === selected?.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      id={`briefing-tab-${p.id}`}
                      data-project-id={p.id}
                      aria-selected={isSel}
                      aria-controls="briefing-project-panel"
                      tabIndex={isSel ? 0 : -1}
                      onClick={() => setSelectedId(p.id)}
                      className={`shrink-0 md:shrink text-left rounded-lg px-2.5 py-2 min-w-[12rem] md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        isSel ? 'bg-white dark:bg-gray-800 shadow-sm ring-1 ring-gray-200 dark:ring-gray-700 border-l-4 border-l-primary-600' : 'hover:bg-white/70 dark:hover:bg-gray-800/60'
                      }`}
                    >
                      <span className="flex items-start gap-2">
                        <span className={`mt-1.5 w-2.5 h-2.5 shrink-0 rounded-full ${LEVEL_DOT[p.level]}`} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug break-words">{p.name}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {p.code && <span className="text-[11px] text-gray-500 dark:text-gray-400">{p.code}</span>}
                            {listChips(p)}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {selected && (
                <div id="briefing-project-panel" role="tabpanel" aria-labelledby={`briefing-tab-${selected.id}`} className="p-4 min-w-0">
                  {projectHeader(selected, true)}
                  {projectBody(selected, ITEMS_ONE)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
