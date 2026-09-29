import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { apiService, type CompanyHolidayChange, type CalendarChangePreview as Preview } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { CalendarChangePreview, fmtDay } from '../../components/schedule/calendar/CalendarChangePreview';

/**
 * Company holidays: one list every project's working calendar picks up. The company
 * owner or an admin changes it; everyone else sees it. Each change shows which tasks
 * move, across all projects, before it is saved (same flow as a project's calendar).
 */
interface Pending { change: CompanyHolidayChange; label: string; preview: Preview | null }

export function HolidaysTab() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['company-holidays'], queryFn: () => apiService.getCompanyHolidays() });
  const [pending, setPending] = useState<Pending | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const canEdit = !!q.data?.canEdit;
  const busy = !!pending || applying;
  const holidays = q.data?.holidays ?? [];
  const byYear = holidays.reduce<Record<string, typeof holidays>>((acc, h) => {
    (acc[h.date.slice(0, 4)] ??= []).push(h);
    return acc;
  }, {});

  const propose = async (change: CompanyHolidayChange, label: string) => {
    setError(null); setDone(null);
    setPending({ change, label, preview: null });
    try {
      setPending({ change, label, preview: await apiService.previewCompanyHoliday(change) });
    } catch (err) {
      setPending(null);
      setError(getApiErrorMessage(err, 'Could not work out what would move. Please try again.'));
    }
  };

  const apply = async () => {
    if (!pending?.preview) return;
    setApplying(true);
    try {
      const res = await apiService.applyCompanyHoliday(pending.change);
      const msg = res.tasksMoved === 0
        ? `Saved. ${pending.label}.`
        : `Saved. ${pending.label}; moved ${res.tasksMoved} task${res.tasksMoved === 1 ? '' : 's'} in ${res.projectsAffected} project${res.projectsAffected === 1 ? '' : 's'}.`;
      setDone(msg); announce(msg);
      setPending(null); setDate(''); setName('');
      await queryClient.invalidateQueries({ queryKey: ['company-holidays'] });
      queryClient.invalidateQueries({ queryKey: ['working-calendar'] });
      queryClient.invalidateQueries({ queryKey: ['nonWorkingDates'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save the change. Nothing was moved.'));
    } finally {
      setApplying(false);
    }
  };

  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Pick a date first.'); return; }
    const n = name.trim() || undefined;
    propose({ add: { date, name: n } }, `${fmtDay(date)}${n ? ` (${n})` : ''} becomes a company holiday`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Company holidays</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-prose">
            Every project treats these as days off. A project can still add its own days off, or work through a company holiday, in its Working calendar.
            {!canEdit && ' Only the company owner or an admin can change this list.'}
          </p>
        </div>

        {q.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
        {q.isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load the holidays. Refresh the page to try again.</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}
        {done && !pending && <p role="status" className="text-sm text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">{done}</p>}

        {pending && (pending.preview
          ? <CalendarChangePreview company label={pending.label} preview={pending.preview} applying={applying} onApply={apply} onCancel={() => setPending(null)} />
          : <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Working out which tasks would move in each project…</p>)}

        {q.data && holidays.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No company holidays yet.</p>}
        {Object.entries(byYear).map(([year, list]) => (
          <section key={year} className="space-y-1.5" aria-label={`Holidays in ${year}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{year}</h3>
            <ul className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
              {list.map(h => (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-36 shrink-0 font-mono text-xs tabular-nums text-gray-900 dark:text-gray-100">{fmtDay(h.date)}</span>
                  <span className="flex-1 min-w-0 break-words text-gray-800 dark:text-gray-200">{h.name || '—'}</span>
                  {canEdit && (
                    <button type="button" disabled={busy} onClick={() => propose({ removeId: h.id }, `${fmtDay(h.date)} is no longer a company holiday`)}
                      aria-label={`Remove ${fmtDay(h.date)}`} title="Remove"
                      className="p-1 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-col gap-1">
              <label htmlFor="ch-date" className="text-xs font-medium text-gray-700 dark:text-gray-300">Date</label>
              <input id="ch-date" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={busy}
                className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <label htmlFor="ch-name" className="text-xs font-medium text-gray-700 dark:text-gray-300">Name</label>
              <input id="ch-name" type="text" value={name} onChange={e => setName(e.target.value)} disabled={busy} maxLength={255}
                placeholder="e.g. Boxing Day"
                className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
            <button type="button" onClick={add} disabled={busy}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
              + Add holiday
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
