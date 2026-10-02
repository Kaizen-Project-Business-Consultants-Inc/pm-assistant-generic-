import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';
import type { PlannerBlock, PlannerPerson } from '../../types/teamPlanner';

const day = (d: string | null | undefined) => (d ? formatCalendarDate(d, { day: 'numeric', month: 'short' }) : '—');
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const WEEK_CHOICES = [-8, -4, -3, -2, -1, 0, 1, 2, 3, 4, 8];

/**
 * Team Planner's drop check: what a move does — both people's weeks before → after, new dates,
 * the tasks linked after it, the project finish, the planned cost — before anything is saved.
 * Reached by dragging a block, or by pressing Enter on it (then the person and week are picked here).
 */
export function PlannerMoveDialog({ block, people, initialTo, initialWeeks, onClose, onDone }: {
  block: PlannerBlock;
  people: PlannerPerson[];
  initialTo: string | null;
  initialWeeks: number;
  onClose: () => void;
  onDone: (r: { changeId: string | null; summary: string; scheduleId: string }) => void;
}) {
  const [toId, setToId] = useState<string>(initialTo ?? block.resourceId ?? '');
  const [weeks, setWeeks] = useState(initialWeeks);
  const [error, setError] = useState<string | null>(null);
  const candidates = people.filter(p => !p.isGeneric && p.id !== block.resourceId);
  const keepsPerson = !toId || toId === block.resourceId;
  const input = { taskId: block.taskId, fromResourceId: block.resourceId, toResourceId: toId || null, weeks: block.started ? 0 : weeks };
  const nothing = keepsPerson && input.weeks === 0;

  const { data: preview, isFetching, error: checkError } = useQuery({
    queryKey: ['planner-check', input.taskId, input.fromResourceId, input.toResourceId, input.weeks],
    queryFn: () => apiService.checkPlannerMove(input),
    enabled: !nothing,
    retry: false,
  });
  const problem = (checkError as any)?.response?.data?.message ?? (checkError ? 'This move could not be checked. Try again.' : null);

  const move = useMutation({
    mutationFn: () => apiService.plannerMove(input),
    onSuccess: r => onDone({ ...r, scheduleId: block.scheduleId }),
    onError: (e: any) => setError(e?.response?.data?.message ?? 'The move was not saved. Try again.'),
  });

  const title = preview?.reassign && preview.dates
    ? `Give "${block.taskName}" to ${preview.toName} and move it?`
    : preview?.reassign ? `Give "${block.taskName}" to ${preview.toName}?`
    : preview?.dates ? `Move "${block.taskName}" ${Math.abs(input.weeks)} week${Math.abs(input.weeks) === 1 ? '' : 's'} ${input.weeks > 0 ? 'later' : 'earlier'}?`
    : `Move "${block.taskName}"`;

  return (
    <AccessibleModal isOpen onClose={onClose} ariaLabel={title} className="w-full max-w-2xl mx-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">{block.projectName} · {day(block.startDate)} – {day(block.endDate)}{block.hoursPerWeek ? ` · ${block.hoursPerWeek}h a week` : ''}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Person</span>
            <select value={toId} onChange={e => setToId(e.target.value)} className="w-full h-10 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
              {block.resourceId ? <option value={block.resourceId}>Keep {people.find(p => p.id === block.resourceId)?.name ?? 'as is'}</option> : <option value="">No one yet — pick a person</option>}
              {candidates.map(p => <option key={p.id} value={p.id}>{p.name}{p.role ? ` (${p.role})` : ''}</option>)}
            </select>
          </label>
          {block.started ? (
            <p className="text-xs text-gray-600 dark:text-gray-400 self-end">This task has started, so its dates stay. You can still give it to someone else.</p>
          ) : (
            <label className="block text-sm">
              <span className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">When</span>
              <select value={weeks} onChange={e => setWeeks(Number(e.target.value))} className="w-full h-10 px-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                {[...new Set([...WEEK_CHOICES, initialWeeks])].sort((a, b) => a - b).map(w => (
                  <option key={w} value={w}>{w === 0 ? 'Same dates' : `${Math.abs(w)} week${Math.abs(w) === 1 ? '' : 's'} ${w > 0 ? 'later' : 'earlier'}`}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {nothing && <p className="text-sm text-gray-600 dark:text-gray-400">Pick another person or another week to see what the move does.</p>}
        {!nothing && isFetching && !preview && <p className="text-sm text-gray-600 dark:text-gray-400" role="status">Checking…</p>}
        {!nothing && problem && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{problem}</p>}

        {!nothing && preview && !problem && (
          <div className="space-y-3" aria-live="polite">
            {preview.dates && (
              <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-gray-600 dark:text-gray-400">Dates</dt>
                <dd className="text-gray-900 dark:text-gray-100">{day(preview.dates.startBefore)} – {day(preview.dates.endBefore)} → <strong>{day(preview.dates.startAfter)} – {day(preview.dates.endAfter)}</strong> (working days)</dd>
                {preview.heldByPredecessor && (<><dt className="text-gray-600 dark:text-gray-400">Note</dt><dd className="text-amber-800 dark:text-amber-300">It can't start earlier than the task it waits for allows, so it starts as early as it can.</dd></>)}
                <dt className="text-gray-600 dark:text-gray-400">Tasks linked after it</dt>
                <dd className="text-gray-900 dark:text-gray-100">{preview.linkedMoved.length === 0 ? 'None move' : <><strong>{preview.linkedMoved.length} move too</strong>: {preview.linkedMoved.slice(0, 4).map(t => t.name).join(', ')}{preview.linkedMoved.length > 4 ? ` and ${preview.linkedMoved.length - 4} more` : ''}</>}</dd>
                <dt className="text-gray-600 dark:text-gray-400">Project finish</dt>
                <dd className={preview.projectEndShift > 0 ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}>
                  {preview.projectEndShift === 0 ? `Unchanged (${day(preview.projectEndBefore)})` : `${day(preview.projectEndBefore)} → ${day(preview.projectEndAfter)} (${preview.projectEndShift > 0 ? '+' : ''}${preview.projectEndShift} working day${Math.abs(preview.projectEndShift) === 1 ? '' : 's'})`}
                </dd>
                {preview.others.length > 1 && (<><dt className="text-gray-600 dark:text-gray-400">Who it moves for</dt><dd className="text-gray-900 dark:text-gray-100">Everyone on the task: {preview.others.join(', ')}</dd></>)}
              </dl>
            )}
            {preview.reassign && !preview.dates && <p className="text-sm text-gray-700 dark:text-gray-300">The dates stay the same.</p>}

            {preview.load.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Hours a week before and after the move</caption>
                  <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-600 dark:text-gray-400">
                    <tr><th scope="col" className="text-left px-3 py-2 font-semibold">Person</th><th scope="col" className="text-left px-3 py-2 font-semibold">Week of → hours a week</th></tr>
                  </thead>
                  <tbody>
                    {preview.load.map(p => (
                      <tr key={p.resourceId} className="border-t border-gray-100 dark:border-gray-700 align-top">
                        <th scope="row" className="text-left px-3 py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{p.name}</th>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {p.weeks.slice(0, 8).map(w => {
                              const over = w.after > w.capacity;
                              return (
                                <span key={w.weekStart} className="whitespace-nowrap text-gray-700 dark:text-gray-300">
                                  {day(w.weekStart)}: {w.before}h → <strong className={over ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'}>{w.after}h</strong>
                                  {over && <span className="ml-1 px-1.5 rounded bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 text-xs font-semibold">over by {Math.round((w.after - w.capacity) * 10) / 10}h</span>}
                                </span>
                              );
                            })}
                            {p.weeks.length > 8 && <span className="text-gray-600 dark:text-gray-400">…{p.weeks.length - 8} more weeks</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.overloads.length > 0 && (
              <p className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
                {[...new Set(preview.overloads.map(o => o.name))].join(' and ')} would be over their hours in {preview.overloads.length} week{preview.overloads.length === 1 ? '' : 's'}. You can still make the move.
              </p>
            )}
            {preview.cost && preview.cost.before !== preview.cost.after && (
              <p className="text-sm text-gray-700 dark:text-gray-300">Planned cost at {preview.toName}'s rate: <strong className="text-gray-900 dark:text-white">{money(preview.cost.before)} → {money(preview.cost.after)}</strong>.</p>
            )}
            {preview.loggedStays && <p className="text-sm text-gray-700 dark:text-gray-300">Hours {preview.fromName} already logged on this task stay with {preview.fromName}.</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button
            type="button"
            onClick={() => { setError(null); move.mutate(); }}
            disabled={nothing || !preview || !!problem || move.isPending}
            className="h-10 px-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {move.isPending ? 'Saving…' : preview?.reassign ? `Give it to ${preview.toName}` : 'Move it'}
          </button>
        </div>
      </div>
    </AccessibleModal>
  );
}
