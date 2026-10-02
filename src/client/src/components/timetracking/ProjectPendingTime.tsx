import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';

/**
 * The PM's view of hours waiting for approval on this project (2026-10-02). Only this project's
 * hours — never the person's other projects. The line manager approves; the PM can flag a line
 * ("these 2 h belong to Data cleanup") so the line manager sees it before deciding.
 */

const week = (ymd: string) => formatCalendarDate(`${ymd}T00:00:00`, { day: 'numeric', month: 'short' }, 'en-US');
const h = (n: number) => `${Math.round(n * 10) / 10}h`;

export function ProjectPendingTime({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [flagging, setFlagging] = useState<{ sheetId: string; taskId: string; note: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { data } = useQuery({ queryKey: ['project-pending-time', projectId], queryFn: () => apiService.getProjectPendingTime(projectId) });
  const pending = data?.pending ?? [];

  const flag = useMutation({
    mutationFn: (f: { sheetId: string; taskId: string; note: string }) => apiService.flagTimesheetLine(f.sheetId, f.taskId, f.note.trim()),
    onSuccess: () => { setFlagging(null); setNotice({ ok: true, text: 'Flag sent to the line manager.' }); queryClient.invalidateQueries({ queryKey: ['project-pending-time', projectId] }); },
    onError: (err: any) => setNotice({ ok: false, text: err?.response?.data?.message || 'The flag could not be sent.' }),
  });

  if (pending.length === 0) return null;
  const total = pending.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.hours, 0), 0);

  return (
    <section aria-labelledby="pending-time-heading" className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 overflow-hidden text-sm">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-baseline gap-x-3">
        <h3 id="pending-time-heading" className="text-base font-semibold text-gray-900 dark:text-white">Waiting for approval</h3>
        <span className="text-gray-600 dark:text-gray-300">{h(total)} on this project · not in costs until the line manager approves</span>
      </div>
      {notice && <p role="status" className={`px-4 pt-2 text-xs ${notice.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{notice.text}</p>}
      {pending.map(p => (
        <div key={`${p.userId}-${p.weekStart}`} className="border-t border-gray-100 dark:border-gray-700 first:border-t-0">
          <div className="px-4 pt-3 pb-1 font-semibold text-gray-900 dark:text-white">{p.userName} · week of {week(p.weekStart)}</div>
          {p.lines.map(l => {
            const open = flagging?.sheetId === p.sheetId && flagging?.taskId === l.taskId;
            return (
              <div key={l.taskId} className="px-4 py-2 flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-[180px] text-gray-800 dark:text-gray-200">{l.taskName}</span>
                <span className="w-24 text-gray-600 dark:text-gray-300">plan {l.plannedThisWeek ? h(l.plannedThisWeek) : '—'}</span>
                <span className={`w-16 font-semibold ${l.plannedThisWeek && l.hours > l.plannedThisWeek ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-white'}`}>{h(l.hours)}</span>
                {p.sheetId && !open && (
                  <button onClick={() => { setNotice(null); setFlagging({ sheetId: p.sheetId!, taskId: l.taskId, note: '' }); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <Flag className="w-3.5 h-3.5" aria-hidden="true" /> Flag this line
                  </button>
                )}
                {open && (
                  <form className="w-full flex gap-2" onSubmit={e => { e.preventDefault(); if (flagging!.note.trim()) flag.mutate(flagging!); }}>
                    <label htmlFor={`flag-${l.taskId}`} className="sr-only">What's wrong with {l.taskName}?</label>
                    <input id={`flag-${l.taskId}`} autoFocus value={flagging!.note} onChange={e => setFlagging({ ...flagging!, note: e.target.value })} placeholder="e.g. these 2h belong to Data cleanup" className="input flex-1 text-xs dark:bg-gray-700 dark:text-gray-100" />
                    <button type="submit" disabled={!flagging!.note.trim() || flag.isPending} className="px-3 py-1.5 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold disabled:opacity-50">Send to line manager</button>
                    <button type="button" onClick={() => setFlagging(null)} className="px-2 text-xs text-gray-600 dark:text-gray-300">Cancel</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
