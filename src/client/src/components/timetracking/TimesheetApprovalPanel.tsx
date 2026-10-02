import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { announce } from '../../utils/announce';
import { formatCalendarDate } from '../../utils/dateUtils';

/**
 * Timesheets to approve (2026-10-02): the line manager's queue. One timesheet per person per week,
 * all their projects; PMs' flags shown on the lines they flagged. Approve, or send back with a reason.
 */

const week = (ymd: string) => formatCalendarDate(`${ymd}T00:00:00`, { day: 'numeric', month: 'short' }, 'en-US');
const h = (n: number) => `${Math.round(n * 10) / 10}h`;

export function TimesheetApprovalPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['timesheet-approvals'], queryFn: () => apiService.getTimesheetApprovals() });
  const queue = data?.timesheets ?? [];
  useEffect(() => { if (!selected && queue.length) setSelected(queue[0].id); }, [queue, selected]);

  const { data: sheet } = useQuery({
    queryKey: ['timesheet', selected],
    queryFn: () => apiService.getTimesheet(selected!),
    enabled: !!selected,
  });

  const done = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: ['timesheet-approvals'] });
    setSelected(null); setReason(''); setError(null); announce(msg);
  };
  const fail = (err: any) => setError(err?.response?.data?.message || 'Something went wrong. Try again.');
  const approve = useMutation({ mutationFn: (id: string) => apiService.approveTimesheetWeek(id), onSuccess: () => done('Timesheet approved'), onError: fail });
  const reject = useMutation({ mutationFn: (id: string) => apiService.rejectTimesheetWeek(id, reason.trim()), onSuccess: () => done('Timesheet sent back'), onError: fail });

  if (isLoading) return <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-gray-600 dark:text-gray-300">
        <CheckCircle2 className="w-8 h-8 text-green-600" aria-hidden="true" />
        <p className="text-sm">No timesheets waiting for you. You'll see the weekly timesheets of the people you're line manager for here.</p>
      </div>
    );
  }

  const projects = sheet ? [...new Set(sheet.lines.map(l => l.projectId))] : [];
  const perProject = projects.map(pid => ({ name: sheet!.lines.find(l => l.projectId === pid)!.projectName, hours: sheet!.lines.filter(l => l.projectId === pid).reduce((n, l) => n + l.workedThisWeek, 0) }));

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start">
      <ul className="w-full lg:w-72 shrink-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {queue.map(t => (
          <li key={t.id}>
            <button
              onClick={() => { setSelected(t.id); setReason(''); setError(null); }}
              aria-current={selected === t.id}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700 ${selected === t.id ? 'bg-primary-50 dark:bg-primary-900/20 border-l-4 border-l-primary-600' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
            >
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{t.userName}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Week of {week(t.weekStart)} · {h(t.totalHours)} · {t.projectCount} project{t.projectCount === 1 ? '' : 's'}</div>
              {t.flagCount > 0 && <div className="text-xs font-semibold text-amber-800 dark:text-amber-200">{t.flagCount} flag{t.flagCount === 1 ? '' : 's'} from a PM</div>}
            </button>
          </li>
        ))}
      </ul>

      {sheet && (
        <div className="flex-1 min-w-0 space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden text-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-baseline gap-x-3">
              <strong className="text-base text-gray-900 dark:text-white">{sheet.userName} · week of {week(sheet.weekStart)}</strong>
              <span className="text-gray-600 dark:text-gray-300">{h(sheet.totals.worked)} worked · {h(sheet.totals.planned)} planned</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_88px_88px] bg-gray-50 dark:bg-gray-900/40 text-xs font-semibold text-gray-700 dark:text-gray-300">
              <div className="px-4 py-2">Project · task</div><div className="py-2 text-center">Planned</div><div className="py-2 text-center">Worked</div>
            </div>
            {sheet.lines.filter(l => l.workedThisWeek > 0 || l.plannedThisWeek > 0).map(l => {
              const flags = sheet.flags.filter(f => f.taskId === l.taskId);
              return (
                <div key={l.taskId} className={`grid grid-cols-[minmax(0,1fr)_88px_88px] border-t border-gray-100 dark:border-gray-700 ${flags.length ? 'bg-amber-50 dark:bg-amber-900/10' : l.overPlanBy > 0 ? 'bg-red-50/70 dark:bg-red-900/10' : ''}`}>
                  <div className="px-4 py-2 space-y-0.5">
                    <div className="text-gray-900 dark:text-white"><strong>{l.projectName}</strong> · {l.taskName}{l.overPlanBy > 0 && <span className="text-red-700 dark:text-red-300 font-semibold"> · over plan by {h(l.overPlanBy)}</span>}</div>
                    {flags.map(f => <div key={f.id} className="text-xs font-semibold text-amber-900 dark:text-amber-200">Flag from {f.flaggedByName}: “{f.note}”</div>)}
                  </div>
                  <div className="py-2 text-center text-gray-600 dark:text-gray-300">{l.plannedThisWeek ? h(l.plannedThisWeek) : '—'}</div>
                  <div className="py-2 text-center font-semibold text-gray-900 dark:text-white">{h(l.workedThisWeek)}</div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
            <strong className="text-gray-900 dark:text-white">When you approve, each project gets the hours:</strong>{' '}
            {perProject.map(p => `${p.name} +${h(p.hours)}`).join(' · ')}
          </div>

          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label htmlFor="ts-reason" className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Reason (needed to send it back)</label>
              <input id="ts-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Move Thursday's 2h to Data cleanup" className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <button onClick={() => reject.mutate(sheet.sheet!.id)} disabled={!reason.trim() || reject.isPending} className="px-4 py-2.5 rounded-lg border border-red-700 text-red-700 dark:border-red-400 dark:text-red-300 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">Send back to {sheet.userName}</button>
            <button onClick={() => approve.mutate(sheet.sheet!.id)} disabled={approve.isPending} className="px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50">{approve.isPending ? 'Approving…' : 'Approve week'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
