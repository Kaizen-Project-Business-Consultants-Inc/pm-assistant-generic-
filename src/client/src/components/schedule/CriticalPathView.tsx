import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { formatCalendarDate, toLocalDate } from '../../utils/dateUtils';
import { useResourceNameMap } from './shared/hooks/useResourceNameMap';

/**
 * The schedule's "Critical path" view (UAT U17, 2026-10-14): the chain of tasks that sets the end
 * date, in order, with dates, owner and status; the near-critical tasks (≤ 5 working days of slack)
 * in amber; and "what to watch" at the top — critical tasks that are late or have nobody on them.
 * Same critical-path calculation (and cache) as the Gantt's Critical path button.
 */
interface ViewTask { id: string; name: string; startDate?: string | null; endDate?: string | null; status?: string; assignedTo?: string | null; progressPercentage?: number; isSummary?: boolean; isMilestone?: boolean }
interface CpmTask { taskId: string; ES: number; totalFloat: number; isCritical: boolean }

const NEAR = 5; // working days of slack that still count as "near-critical"
const DONE = new Set(['completed', 'cancelled']);

/** The critical chain in order, the near-critical tasks, and what to watch (pure, tested) */
export function criticalPathRows(tasks: ViewTask[], cpm: { tasks?: CpmTask[] } | undefined, today: string) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const rows = (cpm?.tasks ?? []).map(c => ({ cpm: c, task: byId.get(c.taskId) })).filter(r => r.task && !r.task.isSummary) as Array<{ cpm: CpmTask; task: ViewTask }>;
  const byStart = (a: { cpm: CpmTask }, b: { cpm: CpmTask }) => a.cpm.ES - b.cpm.ES;
  const critical = rows.filter(r => r.cpm.isCritical).sort(byStart);
  const near = rows.filter(r => !r.cpm.isCritical && r.cpm.totalFloat > 0 && r.cpm.totalFloat <= NEAR).sort((a, b) => a.cpm.totalFloat - b.cpm.totalFloat || byStart(a, b));
  const watch: Array<{ task: ViewTask; why: string }> = [];
  for (const { task } of critical) {
    if (DONE.has(task.status ?? '')) continue;
    const end = task.endDate?.slice(0, 10);
    if (end && end < today) watch.push({ task, why: 'Late — the end date moves with it' });
    else if (!task.assignedTo && !task.isMilestone) watch.push({ task, why: 'Nobody is on it' }); // a milestone is a moment, not work
  }
  return { critical, near, watch };
}

export function CriticalPathView({ scheduleId, tasks }: { scheduleId: string; tasks: ViewTask[] }) {
  const { data: cpm, isLoading, isError } = useQuery({
    queryKey: ['criticalPath', scheduleId],
    queryFn: () => apiService.getCriticalPath(scheduleId),
  });
  const names = useResourceNameMap();
  const { critical, near, watch } = useMemo(() => criticalPathRows(tasks, cpm, toLocalDate()), [tasks, cpm]);

  if (isLoading) return <div className="animate-pulse h-40 rounded-xl bg-gray-200 dark:bg-gray-700" />;
  if (isError) return <p className="text-sm text-red-600 dark:text-red-400">Could not work out the critical path. Refresh the page to try again.</p>;
  if (!cpm || cpm.hasLinks === false) {
    return (
      <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-5 text-sm text-amber-900 dark:text-amber-100">
        <b>Link your tasks first to see the critical path.</b> It is the chain of linked tasks that sets the end date. In the Gantt, open a task and add a <b>Predecessor</b> (the task it waits for).
      </div>
    );
  }

  const who = (t: ViewTask) => (t.assignedTo ? names.get(t.assignedTo) ?? t.assignedTo : '—');
  const date = (d?: string | null) => (d ? formatCalendarDate(d) : '—');
  const table = (title: string, list: Array<{ cpm: CpmTask; task: ViewTask }>, near: boolean) => (
    <section aria-label={title} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
      <h3 className={`px-4 pt-3 pb-2 text-sm font-bold ${near ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>{title} ({list.length})</h3>
      {list.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300">None.</p> : (
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-gray-50 dark:bg-gray-900 text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
            <tr>
              <th className="text-left px-4 py-2">Task</th><th className="text-left px-2 py-2">Start</th><th className="text-left px-2 py-2">End</th>
              <th className="text-left px-2 py-2">Owner</th><th className="text-left px-2 py-2">Status</th>
              {near && <th className="text-right px-4 py-2">Slack</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {list.map(({ cpm: c, task: t }) => (
              <tr key={t.id}>
                <td className="px-4 py-2 font-semibold text-gray-900 dark:text-white">{t.name}</td>
                <td className="px-2 py-2 text-gray-700 dark:text-gray-200 tabular-nums">{date(t.startDate)}</td>
                <td className="px-2 py-2 text-gray-700 dark:text-gray-200 tabular-nums">{date(t.endDate)}</td>
                <td className="px-2 py-2 text-gray-700 dark:text-gray-200">{who(t)}</td>
                <td className="px-2 py-2 text-gray-700 dark:text-gray-200 capitalize">{(t.status ?? '').replace(/_/g, ' ') || '—'}</td>
                {near && <td className="px-4 py-2 text-right tabular-nums text-amber-800 dark:text-amber-200">{c.totalFloat} day{c.totalFloat === 1 ? '' : 's'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        Ends {cpm.finishDate ? formatCalendarDate(cpm.finishDate) : '—'} · {cpm.lengthWorkingDays ?? cpm.projectDuration} working days · {critical.length} critical · {near.length} near-critical
      </p>
      <section aria-label="What to watch" className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
        <h3 className="text-sm font-bold text-red-800 dark:text-red-200">What to watch</h3>
        {watch.length === 0 ? <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">Every critical task is on time and has someone on it.</p> : (
          <ul className="mt-2 space-y-1">
            {watch.map(w => <li key={w.task.id} className="text-sm text-gray-900 dark:text-white"><b>{w.task.name}</b> — {w.why}</li>)}
          </ul>
        )}
      </section>
      {table('Critical tasks, in order', critical, false)}
      {table(`Near-critical (${NEAR} working days of slack or less)`, near, true)}
    </div>
  );
}
