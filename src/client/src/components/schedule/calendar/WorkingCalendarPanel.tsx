import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService, type WorkingCalendarChange, type CalendarChangePreview as Preview } from '../../../services/api';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { announce } from '../../../utils/announce';
import { ViewOnlyNote } from '../../ui/ViewOnlyNote';
import { CalendarChangePreview, fmtDay } from './CalendarChangePreview';

/**
 * The project's working calendar: working weekdays, the company holidays it picks up,
 * and its own days off / extra working days.
 *
 * States: loading → idle ⇄ previewing → preview (Apply → applying → idle | Cancel → idle);
 * any request can end in error (shown, back to idle). One change at a time: while a
 * preview is open the other controls are disabled, so what you apply is what you saw.
 */

const DAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' },
  { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

interface Pending { change: WorkingCalendarChange; label: string; preview: Preview | null }

export function WorkingCalendarPanel({ projectId, projectName, canEdit, onClose, onApplied }: {
  projectId: string;
  projectName?: string;
  canEdit: boolean;
  onClose: () => void;
  /** Refresh the grid after tasks moved */
  onApplied: () => void;
}) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pending, setPending] = useState<Pending | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');

  const calQuery = useQuery({
    queryKey: ['working-calendar', projectId],
    queryFn: () => apiService.getWorkingCalendar(projectId),
  });
  const cal = calQuery.data;

  // Focus once on open; Escape cancels an open preview first, then closes
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (pendingRef.current) setPending(null); else onCloseRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const busy = !!pending || applying;

  const propose = async (change: WorkingCalendarChange, label: string) => {
    setError(null); setDone(null);
    setPending({ change, label, preview: null });
    try {
      const preview = await apiService.previewWorkingCalendar(projectId, change);
      setPending({ change, label, preview });
    } catch (err) {
      setPending(null);
      setError(getApiErrorMessage(err, 'Could not work out what would move. Please try again.'));
    }
  };

  const apply = async () => {
    if (!pending?.preview) return;
    setApplying(true);
    try {
      const res = await apiService.applyWorkingCalendar(projectId, pending.change);
      const msg = res.tasksMoved === 0 ? `Saved. ${pending.label}.` : `Saved. ${pending.label}; moved ${res.tasksMoved} task${res.tasksMoved === 1 ? '' : 's'}.`;
      setDone(msg);
      announce(msg);
      setPending(null); setNewDate(''); setNewName('');
      await queryClient.invalidateQueries({ queryKey: ['working-calendar', projectId] });
      onApplied();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save the change. Nothing was moved.'));
    } finally {
      setApplying(false);
    }
  };

  const toggleDay = (n: number) => {
    if (!cal) return;
    const on = cal.workingDays.includes(n);
    const next = on ? cal.workingDays.filter(d => d !== n) : [...cal.workingDays, n];
    const name = DAYS.find(d => d.n === n)!.label;
    propose({ workingDays: next }, on ? `${name} becomes a day off every week` : `${name} becomes a working day every week`);
  };

  const addDate = (type: 'holiday' | 'working') => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { setError('Pick a date first.'); return; }
    const name = newName.trim() || undefined;
    propose({ add: { date: newDate, type, name } },
      `${fmtDay(newDate)}${name ? ` (${name})` : ''} becomes ${type === 'holiday' ? 'a day off' : 'a working day'} in this project`);
  };

  const exceptions = cal?.exceptions ?? [];
  const overridden = new Set(exceptions.filter(e => e.type === 'working').map(e => e.date));

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10 dark:bg-black/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Working calendar"
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Working calendar</h2>
            <p className="text-xs mt-0.5 text-gray-500 dark:text-gray-400">
              {projectName ? `${projectName} · ` : ''}used for durations and whenever tasks move
            </p>
          </div>
          <button onClick={onClose} aria-label="Close working calendar" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {calQuery.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
          {calQuery.isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load the calendar. Close and try again.</p>}
          {!canEdit && cal && <ViewOnlyNote />}

          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}
          {done && !pending && <p role="status" className="text-sm text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">{done}</p>}

          {pending && (
            pending.preview
              ? <CalendarChangePreview label={pending.label} preview={pending.preview} applying={applying} onApply={apply} onCancel={() => setPending(null)} />
              : <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Working out which tasks would move…</p>
          )}

          {cal && (
            <>
              <section className="space-y-2" aria-labelledby="wc-days">
                <h3 id="wc-days" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Working weekdays</h3>
                <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Working weekdays">
                  {DAYS.map(d => {
                    const on = cal.workingDays.includes(d.n);
                    const cls = `text-center py-2 rounded-lg text-xs font-semibold border ${on
                      ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200 border-primary-400 dark:border-primary-600'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`;
                    return canEdit ? (
                      <button key={d.n} type="button" disabled={busy} aria-pressed={on} onClick={() => toggleDay(d.n)}
                        className={`${cls} hover:ring-2 hover:ring-primary-300 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400`}
                        title={on ? `Make ${d.label} a day off` : `Make ${d.label} a working day`}>
                        {d.label}
                      </button>
                    ) : <span key={d.n} className={cls} aria-label={`${d.label}: ${on ? 'working' : 'day off'}`}>{d.label}</span>;
                  })}
                </div>
                {canEdit && <p className="text-xs text-gray-500 dark:text-gray-400">Click a day to switch it on or off. You'll see what moves before anything changes.</p>}
              </section>

              <section className="space-y-2" aria-labelledby="wc-company">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="wc-company" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Company holidays</h3>
                  <Link to="/settings?tab=holidays" className="text-xs text-primary-700 dark:text-primary-300 hover:underline">Settings → Company holidays</Link>
                </div>
                {cal.companyHolidays.length === 0
                  ? <p className="text-sm text-gray-500 dark:text-gray-400">None set yet.</p>
                  : <ul className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                      {cal.companyHolidays.map(h => (
                        <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="w-32 shrink-0 font-mono text-xs tabular-nums text-gray-900 dark:text-gray-100">{fmtDay(h.date)}</span>
                          <span className="flex-1 min-w-0 break-words text-gray-800 dark:text-gray-200">{h.name}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${overridden.has(h.date) ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                            {overridden.has(h.date) ? 'Worked here' : 'Company'}
                          </span>
                        </li>
                      ))}
                    </ul>}
              </section>

              <section className="space-y-2" aria-labelledby="wc-project">
                <h3 id="wc-project" className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">This project only</h3>
                {exceptions.length === 0
                  ? <p className="text-sm text-gray-500 dark:text-gray-400">No extra days off or working days.</p>
                  : <ul className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                      {exceptions.map(e => (
                        <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="w-32 shrink-0 font-mono text-xs tabular-nums text-gray-900 dark:text-gray-100">{fmtDay(e.date)}</span>
                          <span className="flex-1 min-w-0 break-words text-gray-800 dark:text-gray-200">{e.name || '—'}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${e.type === 'holiday' ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-800 dark:text-primary-200' : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-200'}`}>
                            {e.type === 'holiday' ? 'Day off' : 'Working day'}
                          </span>
                          {canEdit && (
                            <button type="button" disabled={busy} onClick={() => propose({ removeId: e.id }, `${fmtDay(e.date)} is no longer ${e.type === 'holiday' ? 'a day off' : 'an extra working day'} in this project`)}
                              aria-label={`Remove ${fmtDay(e.date)}`} title="Remove"
                              className="p-1 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>}

                {canEdit && (
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-[9.5rem_1fr] gap-2">
                      <label className="sr-only" htmlFor="wc-new-date">Date</label>
                      <input id="wc-new-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} disabled={busy}
                        className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                      <label className="sr-only" htmlFor="wc-new-name">Name (optional)</label>
                      <input id="wc-new-name" type="text" value={newName} onChange={e => setNewName(e.target.value)} disabled={busy} maxLength={255}
                        placeholder="Name, e.g. Team offsite"
                        className="min-w-0 px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" disabled={busy} onClick={() => addDate('holiday')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary-500 text-primary-700 dark:text-primary-300 bg-white dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-primary-900/30 disabled:opacity-60">
                        + Day off
                      </button>
                      <button type="button" disabled={busy} onClick={() => addDate('working')}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-500 text-indigo-700 dark:text-indigo-200 bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-60">
                        + Working day
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">A working day can be a Saturday, or a company holiday this project works through.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
