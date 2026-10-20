import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { apiService } from '../../services/api';
import { SectionRenderer, type ReportSectionData } from './ReportPreview';

/**
 * Report Builder in plain words (2026-10-20, approved mock https://claude.ai/artifact/5UUmYUEJesdXfuhx8V1B5m):
 * the PM types the report they want, sees a draft with real figures, changes it (Edit by hand, or
 * by typing), and nothing is saved until they press Save.
 */

type DraftSection = {
  title?: string;
  type: string;
  dataSource: string;
  filters?: { projectId?: string; status?: string; overdue?: boolean; dateStart?: string; dateEnd?: string };
  groupBy?: string;
  columns?: string[];
};

interface DescribeReportProps {
  /** "Start from blank": today's hand-built path */
  onStartBlank: () => void;
  /** Edit on a section: the whole draft opens in the designer */
  onEditByHand: (sections: DraftSection[]) => void;
  onSaved: () => void;
  /** Back from Edit without saving: the draft as it was, shown again */
  resume?: Record<string, unknown>[];
  /** The draft was saved or discarded (the page forgets the one it kept for Edit) */
  onDone?: () => void;
}

const EXAMPLES = [
  'Hours logged per person this month',
  'Open risks by severity',
  'Tasks by status, all my projects',
];

const TYPE_LABEL: Record<string, string> = {
  kpi: 'Numbers', kpi_card: 'Numbers', table: 'Table', bar_chart: 'Bar chart', line_chart: 'Line chart', pie_chart: 'Pie chart',
};
const SOURCE_LABEL: Record<string, string> = {
  projects: 'Projects', tasks: 'Tasks', time_entries: 'Time logged', budgets: 'Budgets', resources: 'People',
  raid_items: 'Risks, actions, issues, decisions', meetings: 'Meetings', action_items: 'Action items',
};
const PERSON_GROUPS = new Set(['assignee', 'assigned_to', 'assignee_name', 'resource']);

/** "Table · Tasks · Customer Portal · overdue only · grouped by person" */
function howItWasBuilt(s: DraftSection, projectName: (id: string) => string | undefined): string {
  const parts = [TYPE_LABEL[s.type] ?? s.type, SOURCE_LABEL[s.dataSource] ?? s.dataSource];
  if (s.filters?.projectId) parts.push(projectName(s.filters.projectId) ?? 'one project');
  if (s.filters?.overdue) parts.push('overdue only');
  if (s.filters?.status) parts.push(`status ${s.filters.status.replace(/_/g, ' ')}`);
  if (s.filters?.dateStart || s.filters?.dateEnd) parts.push(`${s.filters.dateStart || '…'} to ${s.filters.dateEnd || '…'}`);
  if (s.groupBy) parts.push(`grouped by ${PERSON_GROUPS.has(s.groupBy) ? 'person' : s.groupBy.replace(/_/g, ' ')}`);
  return parts.join(' · ');
}

/** The server's own words for a refusal (no AI left, too long, not allowed), else a plain line */
function messageOf(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string; details?: Array<{ message?: string }> } } })?.response?.data;
  return data?.message || data?.details?.[0]?.message || fallback;
}

const BTN = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50';
const PRIMARY = `${BTN} bg-primary-600 text-white hover:bg-primary-700`;
const SECONDARY = `${BTN} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700`;
const TOOL = 'px-2.5 py-1 text-xs font-medium rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';

export function DescribeReport({ onStartBlank, onEditByHand, onSaved, resume, onDone }: DescribeReportProps) {
  const uid = useId();
  const [request, setRequest] = useState('');
  const [change, setChange] = useState('');
  const [sections, setSections] = useState<DraftSection[] | null>(resume && resume.length ? (resume as DraftSection[]) : null);
  // The figures belong to the sections they were asked for: an older answer (a draft changed or a
  // section removed while it loaded) is dropped, never shown under the wrong section
  const shownSections = useRef<DraftSection[] | null>(sections);
  shownSections.current = sections;
  const [figures, setFigures] = useState<ReportSectionData[]>([]);
  const [notDone, setNotDone] = useState<string[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  // Save report → the name box gets the focus (the person just asked for it)
  useEffect(() => { if (naming) nameRef.current?.focus(); }, [naming]);

  const { data: projectsData } = useQuery({ queryKey: ['projects'], queryFn: () => apiService.getProjects() });
  const projects: Array<{ id: string; name: string }> = projectsData?.data || projectsData?.projects || projectsData || [];
  const projectName = (id: string) => projects.find(p => p.id === id)?.name;

  const preview = useMutation({
    mutationFn: (s: DraftSection[]) => apiService.previewReportSections(s),
    onSuccess: (res, asked) => { if (asked === shownSections.current) setFigures(res?.report?.sections ?? []); },
  });

  // back from Edit: the figures again
  useEffect(() => {
    if (resume?.length) preview.mutate(resume as DraftSection[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the draft it came back with
  }, []);

  const draft = useMutation({
    mutationFn: ({ words, current }: { words: string; current?: DraftSection[] }) => apiService.draftReportFromWords(words, current),
    onSuccess: (res) => {
      const next = (res.draft.sections ?? []) as DraftSection[];
      setSections(next);
      shownSections.current = next;
      setNotDone(res.draft.notDone ?? []);
      setFigures([]);
      setChange('');
      if (next.length > 0) preview.mutate(next);
    },
  });

  const save = useMutation({
    mutationFn: () => apiService.createReportTemplate({ name: name.trim(), config: { sections: sections ?? [] } }),
    // saved: the draft goes (a second click would save it twice)
    onSuccess: () => { discard(); onSaved(); },
  });

  function discard() {
    setSections(null); shownSections.current = null; setFigures([]); setNotDone([]); setNaming(false); setName('');
    draft.reset(); preview.reset(); onDone?.();
  }
  const remove = (i: number) => {
    const next = (sections ?? []).filter((_, j) => j !== i);
    setSections(next);
    shownSections.current = next;
    setFigures([]);
    if (next.length > 0) preview.mutate(next);
  };

  // ---- 1. Describe it ----
  if (!sections) {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          Describe the report you want
        </h2>
        <label htmlFor={`${uid}-ask`} className="block text-sm text-gray-500 dark:text-gray-400 mt-1 mb-2">
          Say what to show and for which project. You'll see a draft before anything is saved.
        </label>
        <textarea
          id={`${uid}-ask`}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Overdue tasks by owner for Customer Portal, plus budget spent vs allocated as a chart"
          className="w-full px-3 py-2 text-sm border-2 border-primary-500 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <button type="button" className={PRIMARY} disabled={!request.trim() || draft.isPending} onClick={() => draft.mutate({ words: request.trim() })}>
            {draft.isPending ? 'Building draft…' : 'Build draft'}
          </button>
          <button type="button" className={SECONDARY} onClick={onStartBlank}>Start from blank</button>
          <span className="text-xs text-gray-500 dark:text-gray-400">Uses AI · about 1–2 cents</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-3" aria-label="Examples">
          {EXAMPLES.map(e => (
            <button key={e} type="button" onClick={() => setRequest(e)} className="px-3 py-1 text-xs font-medium rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-100">
              {e}
            </button>
          ))}
        </div>
        <div aria-live="polite">
          {draft.isError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{messageOf(draft.error, 'The draft could not be made. Try again, or start from blank.')}</p>}
        </div>
      </div>
    );
  }

  // ---- 2. Check the draft, change it, then save ----
  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-500 bg-primary-50 dark:bg-primary-900/30 px-4 py-3">
        <p className="text-sm text-gray-800 dark:text-gray-100">
          <strong>Draft — not saved.</strong>{' '}
          <span className="text-gray-600 dark:text-gray-300">Built from your words. Check it, change it, then save.</span>
        </p>
        {naming ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
            <label htmlFor={`${uid}-name`} className="text-sm text-gray-700 dark:text-gray-200">Report name</label>
            <input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              ref={nameRef}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
            <button type="submit" className={PRIMARY} disabled={!name.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" className={SECONDARY} onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <div className="flex gap-2">
            <button type="button" className={PRIMARY} disabled={sections.length === 0} onClick={() => setNaming(true)}>Save report</button>
            <button type="button" className={SECONDARY} onClick={discard}>Discard</button>
          </div>
        )}
      </div>
      {save.isError && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{messageOf(save.error, 'The report could not be saved. Try again.')}</p>}

      {sections.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">Nothing in your request could be built as a report section. Try different words, or start from blank.</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sections.map((s, i) => (
          <div key={`${i}-${s.title ?? ''}`} className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{howItWasBuilt(s, projectName)}</p>
              <div className="flex gap-1.5">
                <button type="button" className={TOOL} onClick={() => onEditByHand(sections)} aria-label={`Edit ${s.title ?? 'this section'}`}>Edit</button>
                <button type="button" className={TOOL} onClick={() => remove(i)} aria-label={`Remove ${s.title ?? 'this section'}`}>Remove</button>
              </div>
            </div>
            {figures[i]
              ? <SectionRenderer section={figures[i]} />
              : (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{s.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{preview.isError ? 'The figures could not be loaded.' : 'Loading figures…'}</p>
                </div>
              )}
          </div>
        ))}
      </div>

      {notDone.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-gray-800 dark:text-gray-100">
          <strong className="text-red-700 dark:text-red-300">Not in this draft:</strong>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {notDone.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <label htmlFor={`${uid}-change`} className="block text-sm text-gray-500 dark:text-gray-400 mb-2">
          <strong className="text-gray-900 dark:text-white">Change it by typing</strong> — or use Edit on a section
        </label>
        <textarea
          id={`${uid}-change`}
          value={change}
          onChange={(e) => setChange(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="e.g. Make the chart a pie and add open risks by severity"
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <button type="button" className={PRIMARY} disabled={!change.trim() || draft.isPending} onClick={() => draft.mutate({ words: change.trim(), current: sections })}>
            {draft.isPending ? 'Updating draft…' : 'Update draft'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">Uses AI · about 1 cent</span>
        </div>
        <div aria-live="polite">
          {draft.isError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{messageOf(draft.error, 'The draft could not be changed. Try again, or use Edit.')}</p>}
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">After saving it works as today: open, share, export, schedule.</p>
    </div>
  );
}
