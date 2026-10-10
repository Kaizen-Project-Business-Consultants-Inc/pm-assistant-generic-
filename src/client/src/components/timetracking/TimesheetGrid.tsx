import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Send, Undo2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';
import { announce } from '../../utils/announce';
import { toLocalDate, formatCalendarDate } from '../../utils/dateUtils';
import type { TimesheetLine, WeekView, SheetStatus } from '../../types/timesheet';

/**
 * My timesheet (2026-10-02): one week, every project, one Submit to my line manager. Each line
 * is a task with the hours planned for me this week, my hours per day (typed straight in) and how
 * far the task is — worked out from approved hours, so there's no "time left" to enter.
 */

const STATUS: Record<SheetStatus, { label: string; classes: string }> = {
  draft: { label: 'Draft', classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200' },
  submitted: { label: 'Waiting for approval', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  approved: { label: 'Approved', classes: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  rejected: { label: 'Sent back', classes: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
};

const addDays = (ymd: string, n: number) => toLocalDate(new Date(new Date(`${ymd}T00:00:00`).getTime() + n * 86_400_000));
const dayLabel = (ymd: string) => formatCalendarDate(`${ymd}T00:00:00`, { weekday: 'short', day: 'numeric' }, 'en-US');
const isWeekend = (ymd: string) => { const d = new Date(`${ymd}T00:00:00`).getDay(); return d === 0 || d === 6; };
const h = (n: number) => `${Math.round(n * 10) / 10}h`;

function TaskSoFar({ line }: { line: TimesheetLine }) {
  if (line.taskPlanned <= 0) return <span className="text-gray-500 dark:text-gray-400">Not planned for you</span>;
  if (line.overPlanBy > 0) {
    return <span className="font-semibold text-red-700 dark:text-red-300">Over plan by {h(line.overPlanBy)} ({h(line.taskPlanned + line.overPlanBy)} of {h(line.taskPlanned)})</span>;
  }
  if (line.remaining === 0 && !line.taskDone) return <span className="font-semibold text-amber-800 dark:text-amber-200">0h left · 99% until marked done</span>;
  return <span className="text-gray-600 dark:text-gray-300">{h(line.remaining)} of {h(line.taskPlanned)} left · {line.percent}%</span>;
}

export function TimesheetGrid() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => toLocalDate(new Date()));
  const [error, setError] = useState<string | null>(null);

  const { data: week, isLoading } = useQuery({
    queryKey: ['my-week', date],
    queryFn: () => apiService.getMyWeek(date),
  });
  const refresh = (view?: WeekView) => {
    if (view) queryClient.setQueryData(['my-week', date], view);
    queryClient.invalidateQueries({ queryKey: ['my-week', date] });
  };
  const fail = (err: any) => setError(err?.response?.data?.message || err?.response?.data?.error || 'Something went wrong. Try again.');

  const saveCell = useMutation({
    mutationFn: async ({ line, day, hours }: { line: TimesheetLine; day: string; hours: number }) => {
      const existing = line.days[day];
      if (existing && hours <= 0) return apiService.deleteTimeEntry(existing.entryId);
      if (existing) return apiService.updateTimeEntry(existing.entryId, { hours });
      if (hours > 0) return apiService.createTimeEntry({ taskId: line.taskId, scheduleId: line.scheduleId, projectId: line.projectId, date: day, hours });
      return null;
    },
    onSuccess: () => { setError(null); refresh(); },
    onError: (err) => { fail(err); refresh(); },
  });
  const submit = useMutation({
    mutationFn: () => apiService.submitWeek(date),
    onSuccess: (view) => { setError(null); refresh(view); announce(`Timesheet sent to ${view.approver?.name ?? 'your line manager'}`); },
    onError: fail,
  });
  const recall = useMutation({
    mutationFn: () => apiService.recallWeek(date),
    onSuccess: (view) => { setError(null); refresh(view); announce('Timesheet recalled'); },
    onError: fail,
  });

  const editable = !!week && (week.status === 'draft' || week.status === 'rejected');
  const projects = week ? [...new Set(week.lines.map(l => l.projectId))] : [];
  const dayTotals = week ? week.days.map(d => week.lines.reduce((n, l) => n + (l.days[d]?.hours ?? 0), 0)) : [];
  const grid = { gridTemplateColumns: `minmax(220px, 2fr) 92px repeat(7, minmax(52px, 1fr)) 76px minmax(190px, 1.6fr)` };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(week?.weekStart ?? date, -7))} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700" aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[150px] text-center">
            {week ? `${formatCalendarDate(`${week.days[0]}T00:00:00`, { day: 'numeric', month: 'short' }, 'en-US')} – ${formatCalendarDate(`${week.days[6]}T00:00:00`, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-US')}` : '…'}
          </span>
          <button onClick={() => setDate(addDays(week?.weekStart ?? date, 7))} className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700" aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setDate(toLocalDate(new Date()))} className="px-3 py-2 text-sm rounded-lg text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30">This week</button>
        </div>
        {week && <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS[week.status].classes}`}>{STATUS[week.status].label}</span>}
        {week?.approver && <span className="text-sm text-gray-600 dark:text-gray-300">Approver: <strong className="text-gray-900 dark:text-white">{week.approver.name}</strong> (line manager)</span>}
      </div>

      {week?.status === 'rejected' && week.sheet?.rejectionReason && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20 px-4 py-3 text-sm text-red-900 dark:text-red-200">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span><strong>Sent back:</strong> {week.sheet.rejectionReason} Fix the hours and send the week again.</span>
        </div>
      )}
      {week?.lockNote && (
        <p role="status" className="rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200">{week.lockNote}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be focusable (WCAG 2.1.1) */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" tabIndex={0} role="region" aria-label="Timesheet">
        <div className="min-w-[1000px] text-sm">
          <div className="grid bg-gray-50 dark:bg-gray-900/40 text-xs font-semibold text-gray-700 dark:text-gray-300" style={grid}>
            <div className="px-4 py-2.5">Task</div>
            <div className="px-2 py-2.5 text-center">Planned this week</div>
            {(week?.days ?? Array(7).fill('')).map((d, i) => <div key={d || i} className={`px-1 py-2.5 text-center ${d && isWeekend(d) ? 'text-gray-500 dark:text-gray-400' : ''}`}>{d ? dayLabel(d) : ''}</div>)}
            <div className="px-2 py-2.5 text-center">Actual</div>
            <div className="px-4 py-2.5">Task so far</div>
          </div>

          {isLoading && <div className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">Loading your week…</div>}
          {week && week.lines.length === 0 && (
            <div className="px-4 py-10 text-center text-gray-600 dark:text-gray-300">Nothing planned for you this week. Use <strong>Log Time</strong> to add hours on any task.</div>
          )}

          {week && projects.map(pid => {
            // eslint-disable-next-line no-restricted-syntax -- small: your own week, a few projects × your few task lines
            const lines = week.lines.filter(l => l.projectId === pid);
            return (
              <div key={pid}>
                <div className="px-4 py-1.5 text-xs font-bold text-primary-800 dark:text-primary-200 bg-primary-50 dark:bg-primary-900/20 border-t border-gray-200 dark:border-gray-700">{lines[0].projectName}</div>
                {lines.map(line => (
                  <div key={line.taskId} className={`grid items-center border-t border-gray-100 dark:border-gray-700 ${line.overPlanBy > 0 ? 'bg-red-50/70 dark:bg-red-900/10' : ''}`} style={grid}>
                    <div className="px-4 py-2 text-gray-900 dark:text-white">{line.taskName}</div>
                    <div className="px-2 py-2 text-center text-gray-600 dark:text-gray-300">{line.plannedThisWeek > 0 ? h(line.plannedThisWeek) : '—'}</div>
                    {week.days.map(d => {
                      const cell = line.days[d];
                      const locked = !editable || cell?.status === 'approved' || week.lockedDays.includes(d);
                      return (
                        <div key={d} className={`px-1 py-1 ${isWeekend(d) ? 'bg-gray-50 dark:bg-gray-900/30' : ''}`}>
                          <label className="sr-only" htmlFor={`h-${line.taskId}-${d}`}>{line.taskName}, {dayLabel(d)}</label>
                          <input
                            id={`h-${line.taskId}-${d}`}
                            type="number" min={0} max={24} step={0.5} inputMode="decimal"
                            key={`${d}-${cell?.hours ?? ''}`}
                            defaultValue={cell ? cell.hours : ''}
                            disabled={locked || saveCell.isPending}
                            onBlur={(e) => {
                              const v = e.target.value.trim() === '' ? 0 : Number(e.target.value);
                              if (Number.isNaN(v) || v < 0 || v > 24) { setError('Enter hours between 0 and 24.'); return; }
                              if (v !== (cell?.hours ?? 0)) saveCell.mutate({ line, day: d, hours: v });
                            }}
                            className="w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-1.5 py-1.5 text-center text-sm text-gray-900 dark:text-white disabled:bg-transparent disabled:border-transparent"
                          />
                        </div>
                      );
                    })}
                    <div className="px-2 py-2 text-center font-semibold text-gray-900 dark:text-white">{h(line.workedThisWeek)}</div>
                    <div className="px-4 py-2 text-xs"><TaskSoFar line={line} /></div>
                  </div>
                ))}
              </div>
            );
          })}

          {week && week.lines.length > 0 && (
            <div className="grid items-center border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 font-semibold text-gray-900 dark:text-white" style={grid}>
              <div className="px-4 py-2.5">Week total</div>
              <div className="px-2 py-2.5 text-center">{h(week.totals.planned)}</div>
              {dayTotals.map((t, i) => <div key={i} className="px-1 py-2.5 text-center">{t ? Math.round(t * 10) / 10 : '–'}</div>)}
              <div className="px-2 py-2.5 text-center">{h(week.totals.worked)}</div>
              <div />
            </div>
          )}
        </div>
      </div>

      {week && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 max-w-3xl">
            <p><strong className="text-gray-800 dark:text-gray-200">Planned this week</strong> is your share of each task's plan for this week, spread over its working days.</p>
            <p><strong className="text-gray-800 dark:text-gray-200">Task so far</strong> is worked out from approved hours — there's no time left to enter.</p>
          </div>
          {editable && (
            <button
              onClick={() => submit.mutate()}
              disabled={submit.isPending || week.totals.worked <= 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50"
            >
              <Send className="w-4 h-4" aria-hidden="true" /> {submit.isPending ? 'Sending…' : `Submit week to ${week.approver?.name ?? 'your line manager'}`}
            </button>
          )}
          {week.status === 'submitted' && (
            <button onClick={() => recall.mutate()} disabled={recall.isPending} className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              <Undo2 className="w-4 h-4" aria-hidden="true" /> {recall.isPending ? 'Recalling…' : 'Recall to change'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
