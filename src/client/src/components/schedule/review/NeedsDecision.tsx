import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListFilter, CalendarCog, Undo2, Bookmark, Loader2 } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { severityColor } from '../../../utils/severityColors';
import { refreshAfterScheduleChange } from '../../../utils/scheduleChanged';
import { formatCalendarDate } from '../../../utils/dateUtils';
import { TaskTickRow, TickBar, useTicks, type TaskPickingProps } from './reviewTaskPicking';

/**
 * Propose fixes — "Needs your decision" (2026-10-18). The review findings no proposed fix answers
 * (worked out on the server, by rule and task), each with a plain sentence and buttons that open
 * screens that already exist: the plan with those rows highlighted, Edit project, the newest
 * History change's Undo, and Save baseline. No new editing screens.
 * U81 (2026-10-24): each decision lists its tasks — tick them, click one to light its row up in the plan,
 * and delete the ticked ones after one question.
 */

type Level = 'critical' | 'high' | 'medium' | 'low';

/** One rule's open findings (server OpenFinding) */
export interface OpenFinding {
  ruleId: string;
  rule: string;
  severity: Level;
  taskIds: string[];
  message: string;
}

interface DecisionActions {
  /** Highlight these rows in the plan */
  onShowTasks?: (taskIds: string[]) => void;
  /** Open Edit project (to move the end date) */
  onEditProject?: () => void;
  /** Undo the newest History change — offered only when that is the Apply that moved the finish */
  onUndoLastApply?: () => void;
  undoing?: boolean;
  /** Save a baseline of the plan as it is now */
  onSaveBaseline?: () => void;
  savingBaseline?: boolean;
  baselineSaved?: boolean;
}

/**
 * The buttons' wiring. "Undo the last Apply" is offered only for R06 and only while the
 * newest Schedule History change is an Apply of review fixes that can still be undone (the History
 * rule) — the same Undo as in History.
 */
export function useDecisionActions({ scheduleId, projectId, items: proposed, hidden, onShowTasks, onShown, onEditProject, onSaveBaseline, onUndone, onError }: {
  scheduleId: string;
  projectId: string;
  /** The proposal's open findings (none on proposals made before 2026-10-18) */
  items: OpenFinding[] | undefined;
  /** After Apply the list is out of date: nothing is shown */
  hidden: boolean;
  onShowTasks?: (taskIds: string[]) => void;
  onShown?: () => void;
  onEditProject?: () => void;
  onSaveBaseline?: () => Promise<unknown>;
  onUndone: () => void;
  onError: (message: string) => void;
}): { items: OpenFinding[]; actions: DecisionActions } {
  const items = hidden || !proposed ? NONE : proposed;
  const hasR06 = items.some(f => f.ruleId === 'R06');
  const changes = useQuery<Array<{ id: string; kind: string; undoable: boolean }>>({
    queryKey: ['schedule-changes', scheduleId], // shared with Schedule History
    queryFn: () => apiService.getScheduleChanges(scheduleId),
    enabled: hasR06,
    staleTime: 0,
  });
  const newest = changes.data?.[0];
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: () => apiService.undoScheduleChange(scheduleId, newest!.id),
    onSuccess: () => {
      refreshAfterScheduleChange(queryClient, { scheduleId, projectId }); // History, the plan and the review fetch again
      onUndone();
    },
    onError: (err: unknown) => onError(getApiErrorMessage(err, 'The undo did not complete. Please try again.')),
  });
  const [baselineSaved, setBaselineSaved] = useState(false);
  const baseline = useMutation({
    mutationFn: () => onSaveBaseline!(),
    onSuccess: () => { setBaselineSaved(true); announce('Baseline saved'); },
    onError: (err: unknown) => onError(getApiErrorMessage(err, 'Could not save a baseline')),
  });
  return {
    items,
    actions: {
      onShowTasks: onShowTasks ? (ids: string[]) => { onShown?.(); onShowTasks(ids); } : undefined,
      onEditProject,
      onUndoLastApply: hasR06 && newest?.kind === 'review_fix' && newest.undoable ? () => undo.mutate() : undefined,
      undoing: undo.isPending,
      onSaveBaseline: onSaveBaseline ? () => baseline.mutate() : undefined,
      savingBaseline: baseline.isPending,
      baselineSaved,
    },
  };
}

const NONE: OpenFinding[] = [];

const LEVEL_LABEL: Record<Level, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** What each rule means for the PM, in a sentence */
const PLAIN: Record<string, string> = {
  R06: 'These tasks end after the project’s end date. Move the end date, or undo the last Apply if it pushed them.',
  R08: 'Marked In Progress, past their end date, and 0% done. Update their progress or their dates.',
  R09: 'Their end date has passed and they are not finished. Update their progress, or give them new dates.',
  R10: 'No one is named to do these tasks.',
  R13: 'These tasks are very long. Split them into steps you can track.',
  R18: 'The plan has no baseline, so there is nothing to measure slippage against.',
  R20: 'These gates have no buffer in front of them, and none could be offered automatically.',
};

const btn = 'inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60';

function showLabel(f: OpenFinding): string {
  const n = f.taskIds.length;
  if (f.ruleId === 'R10') return `Assign owners… (show the ${n})`;
  if (f.ruleId === 'R20') return `Show the ${n} gate${n === 1 ? '' : 's'} in the plan`;
  if (f.ruleId in PLAIN) return `Show the ${n} in the plan`;
  return 'Open these tasks';
}

function Buttons({ f, a }: { f: OpenFinding; a: DecisionActions }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {f.taskIds.length > 0 && a.onShowTasks && (
        <button type="button" className={btn} onClick={() => a.onShowTasks!(f.taskIds)}>
          <ListFilter className="w-3 h-3" aria-hidden="true" /> {showLabel(f)}
        </button>
      )}
      {f.ruleId === 'R06' && a.onEditProject && (
        <button type="button" className={btn} onClick={a.onEditProject}>
          <CalendarCog className="w-3 h-3" aria-hidden="true" /> Edit project end date
        </button>
      )}
      {f.ruleId === 'R06' && a.onUndoLastApply && (
        <button type="button" className={btn} onClick={a.onUndoLastApply} disabled={a.undoing}>
          {a.undoing ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3 h-3" aria-hidden="true" />} Undo the last Apply
        </button>
      )}
      {f.ruleId === 'R18' && a.onSaveBaseline && (a.baselineSaved ? (
        <span className="text-xs font-medium text-green-700 dark:text-green-300">Baseline saved.</span>
      ) : (
        <button type="button" className={btn} onClick={a.onSaveBaseline} disabled={a.savingBaseline}>
          {a.savingBaseline ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Bookmark className="w-3 h-3" aria-hidden="true" />} Save a baseline now
        </button>
      ))}
    </div>
  );
}

/** Tasks listed under a decision before "Show all" */
const FIRST_TASKS = 8;

/**
 * The decisions as they stand now: tasks deleted since the proposal was made (they are no longer in the
 * plan) drop out, and a decision whose tasks are all gone goes with them. Whole-plan decisions stay.
 */
export function liveDecisions(items: OpenFinding[], taskInfoOf: TaskPickingProps['taskInfoOf']): OpenFinding[] {
  if (!taskInfoOf) return items;
  const out: OpenFinding[] = [];
  for (const f of items) {
    // eslint-disable-next-line no-restricted-syntax -- a decision's own task ids, each looked up in a Map (no search)
    const taskIds = f.taskIds.filter(id => taskInfoOf(id));
    if (taskIds.length > 0 || f.taskIds.length === 0) out.push({ ...f, taskIds });
  }
  return out;
}

/** The span the tasks cover — what the project dates would have to take in (R06) */
function taskSpan(ids: string[], taskInfoOf: TaskPickingProps['taskInfoOf']): string | null {
  let first = '';
  let last = '';
  for (const id of ids) {
    const info = taskInfoOf?.(id);
    const start = (info?.startDate ?? '').slice(0, 10);
    const end = (info?.endDate ?? '').slice(0, 10);
    if (start && (!first || start < first)) first = start;
    if (end && (!last || end > last)) last = end;
  }
  return first && last ? `These tasks run from ${formatCalendarDate(first)} to ${formatCalendarDate(last)}.` : null;
}

export function NeedsDecision({ items, actions, picking, onTasksDeleted }: { items: OpenFinding[]; actions: DecisionActions; picking?: TaskPickingProps; onTasksDeleted?: () => void }) {
  const [open, setOpen] = useState(true);
  const ticks = useTicks();
  const [pointed, setPointed] = useState<string | null>(null);
  const [allShown, setAllShown] = useState<Set<string>>(new Set());
  const { taskInfoOf, rowNumberOf, onDeleteTasks } = picking ?? {};
  const shown = liveDecisions(items, taskInfoOf);
  if (shown.length === 0) return null;
  const point = (key: string, ids: string[]) => {
    setPointed(key);
    actions.onShowTasks?.(ids);
  };
  return (
    <section aria-label="Needs your decision" className="pt-3 border-t border-gray-200 dark:border-gray-700">
      <h3>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full text-left text-sm font-semibold text-gray-900 dark:text-gray-100">
          Needs your decision ({shown.length})
        </button>
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">The review found these, and no fix above changes them. They need you, not a rule.</p>
      {open && (
        <ul className="mt-2 space-y-2">
          {shown.map(f => {
            const listed = !!taskInfoOf && f.taskIds.length > 0;
            const every = listed && f.taskIds.every(id => ticks.ticked.has(id));
            const more = f.taskIds.length > FIRST_TASKS && !allShown.has(f.ruleId);
            return (
              <li key={f.ruleId} className={`rounded-lg border px-3 py-2 ${pointed === f.ruleId ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${severityColor(f.severity)}`}>{LEVEL_LABEL[f.severity]}</span>
                  <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{f.rule}</span>
                  {f.taskIds.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-400">· {f.taskIds.length} task{f.taskIds.length === 1 ? '' : 's'}</span>}
                </div>
                <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{PLAIN[f.ruleId] ?? f.message}</p>
                {f.ruleId === 'R06' && taskSpan(f.taskIds, taskInfoOf) && <p className="text-xs font-medium text-gray-800 dark:text-gray-200 mt-0.5">{taskSpan(f.taskIds, taskInfoOf)}</p>}
                <Buttons f={f} a={{ ...actions, onShowTasks: actions.onShowTasks ? ids => point(f.ruleId, ids) : undefined }} />
                {listed && (
                  <div className="mt-2 space-y-1">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={every} onChange={e => ticks.setMany(f.taskIds, e.target.checked)} className="rounded border-gray-300 text-primary-600" />
                      Select all {f.taskIds.length} task{f.taskIds.length === 1 ? '' : 's'}
                    </label>
                    <ul className="space-y-1" aria-label={`Tasks: ${f.rule}`}>
                      {(more ? f.taskIds.slice(0, FIRST_TASKS) : f.taskIds).map(id => (
                        <TaskTickRow
                          key={id}
                          id={id}
                          ticked={ticks.ticked.has(id)}
                          pointed={pointed === `${f.ruleId}:${id}`}
                          info={taskInfoOf?.(id)}
                          rowNumber={rowNumberOf?.(id)}
                          onToggle={ticks.toggle}
                          onPoint={taskId => point(`${f.ruleId}:${taskId}`, [taskId])}
                        />
                      ))}
                    </ul>
                    {more && (
                      <button type="button" onClick={() => setAllShown(prev => new Set(prev).add(f.ruleId))} className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
                        Show all {f.taskIds.length} tasks
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="sticky bottom-0 -mx-4 mt-2">
        <TickBar
          unit="task"
          count={ticks.ticked.size}
          taskIds={[...ticks.ticked]}
          onShow={ids => point('ticked', ids)}
          onDeleteTasks={onDeleteTasks}
          taskInfoOf={taskInfoOf}
          onDeleted={() => { ticks.clear(); setPointed(null); actions.onShowTasks?.([]); onTasksDeleted?.(); }}
        />
      </div>
    </section>
  );
}
