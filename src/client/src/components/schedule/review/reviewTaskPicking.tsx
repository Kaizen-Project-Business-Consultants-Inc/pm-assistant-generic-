import { useCallback, useEffect, useRef, useState } from 'react';
import { ListFilter, Trash2, Loader2 } from 'lucide-react';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { formatCalendarDate } from '../../../utils/dateUtils';

/**
 * Picking tasks out of a review (U81, 2026-10-24): the Review panel and Propose fixes both let the PM
 * tick findings or tasks, light their rows up in the plan, and delete the ticked tasks after one
 * question (recorded in Schedule History, one Undo there). One set of pieces for both panels.
 */

/** The most tasks one delete takes — the server refuses more (routes/core/bulk.ts MAX_BULK) */
export const MAX_DELETE_AT_ONCE = 100;

/** What a panel needs to know about a task to list it */
export interface ReviewTaskInfo {
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  isSummary?: boolean;
}

export interface TaskPickingProps {
  taskInfoOf?: (taskId: string) => ReviewTaskInfo | undefined;
  rowNumberOf?: (taskId: string) => number | undefined;
  /** Delete tasks from the plan (the Schedule screen's own delete: History entry, Ctrl+Z); absent for people who cannot edit */
  onDeleteTasks?: (taskIds: string[]) => Promise<void>;
}

/** The ticked ids, with the few moves a panel needs */
export function useTicks() {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const setMany = useCallback((ids: string[], on: boolean) => setTicked(prev => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  }), []);
  const clear = useCallback(() => setTicked(new Set()), []);
  return { ticked, toggle, setMany, clear };
}

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60';
const dangerBtn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-red-600 text-red-700 dark:border-red-400 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-60';

/**
 * The bar under a list while something is ticked: how many, "Show in plan", and "Delete … tasks…"
 * which asks first. `unit` is what was ticked ("findings" or "tasks"); `taskIds` are the tasks behind the ticks.
 */
export function TickBar({ unit, count, taskIds, onShow, onDeleteTasks, taskInfoOf, onDeleted }: {
  unit: 'finding' | 'task';
  count: number;
  taskIds: string[];
  onShow: (taskIds: string[]) => void;
  onDeleteTasks?: (taskIds: string[]) => Promise<void>;
  taskInfoOf?: TaskPickingProps['taskInfoOf'];
  onDeleted: (taskIds: string[]) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  // Nothing ticked any more: a question left open must not wait for the next ticks
  useEffect(() => { if (count === 0) { setAsking(false); setError(null); } }, [count]);
  // Keyboard: the question takes focus ("Keep them" is the safe answer) and gives it back to Delete
  useEffect(() => { if (asking) keepRef.current?.focus(); }, [asking]);
  const cancel = () => { setAsking(false); setError(null); requestAnimationFrame(() => deleteRef.current?.focus()); };
  if (count === 0) return null;
  const n = taskIds.length;
  const phases = taskIds.some(id => taskInfoOf?.(id)?.isSummary);
  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDeleteTasks!(taskIds);
      announce(`Deleted ${n} task${n === 1 ? '' : 's'}`);
      setAsking(false);
      // the bar goes away with its ticks: focus goes to the panel, not to nowhere
      barRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
      onDeleted(taskIds);
    } catch (err) {
      setError(getApiErrorMessage(err, 'The tasks were not deleted. Please try again.'));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div ref={barRef} role="group" aria-label={`Actions for the ${unit}s you ticked`} className="space-y-2 px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs font-semibold text-gray-800 dark:text-gray-100" aria-live="polite">
          {count} {unit}{count === 1 ? '' : 's'} ticked{unit === 'finding' ? ` · ${n} task${n === 1 ? '' : 's'}` : ''}
        </span>
        {n > 0 && (
          <button type="button" className={btn} onClick={() => onShow(taskIds)}>
            <ListFilter className="w-3 h-3" aria-hidden="true" /> Show in plan
          </button>
        )}
        {n > MAX_DELETE_AT_ONCE && onDeleteTasks && (
          <span className="text-xs text-gray-600 dark:text-gray-300">Delete takes up to {MAX_DELETE_AT_ONCE} tasks at a time. Tick fewer to delete.</span>
        )}
        {n > 0 && n <= MAX_DELETE_AT_ONCE && onDeleteTasks && !asking && (
          <button ref={deleteRef} type="button" className={dangerBtn} onClick={() => setAsking(true)}>
            <Trash2 className="w-3 h-3" aria-hidden="true" /> Delete {n} task{n === 1 ? '' : 's'}…
          </button>
        )}
      </div>
      {asking && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape cancels the question (the panel behind would close otherwise); the buttons inside are the interaction
        <div role="alertdialog" aria-label="Delete tasks" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } }} className="rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-900 px-3 py-2 space-y-2">
          <p className="text-xs text-gray-800 dark:text-gray-200">
            Delete {n} task{n === 1 ? '' : 's'}? {n === 1 ? 'It is' : 'They are'} removed from the plan and recorded in Schedule History. Undo there puts {n === 1 ? 'it' : 'them'} back.
            {phases && ' A phase takes its own tasks with it.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={dangerBtn} onClick={remove} disabled={deleting}>
              {deleting && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />} Yes, delete {n}
            </button>
            <button ref={keepRef} type="button" className={btn} onClick={cancel} disabled={deleting}>Keep {n === 1 ? 'it' : 'them'}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

/** One task in a decision: tick box, row number, name, dates. Clicking the name lights the row up in the plan. */
export function TaskTickRow({ id, ticked, pointed, info, rowNumber, onToggle, onPoint }: {
  id: string;
  ticked: boolean;
  pointed: boolean;
  info?: ReviewTaskInfo;
  rowNumber?: number;
  onToggle: (id: string) => void;
  onPoint: (id: string) => void;
}) {
  const name = info?.name ?? 'A task that is no longer in the plan';
  const dates = info?.startDate || info?.endDate ? `${formatCalendarDate(info?.startDate)} → ${formatCalendarDate(info?.endDate)}` : '';
  return (
    <li className={`flex items-center gap-2 rounded-md border px-2 py-1 ${pointed ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30' : 'border-gray-200 dark:border-gray-700'}`}>
      <input type="checkbox" checked={ticked} onChange={() => onToggle(id)} aria-label={`Tick ${rowNumber != null ? `row ${rowNumber}, ` : ''}${name}`} className="rounded border-gray-300 text-primary-600" />
      <button type="button" onClick={() => onPoint(id)} aria-pressed={pointed} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs">
        {rowNumber != null && <span className="w-7 shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{rowNumber}</span>}
        <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">{name}</span>
        {dates && <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">{dates}</span>}
      </button>
    </li>
  );
}
