import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import type { CalendarChangePreview } from '../../services/api';
import { HolidaysTab } from '../../pages/settings/HolidaysTab';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * A pool's holidays (U8). A client uses a named holiday calendar (e.g. "Ontario 2027") — its
 * projects' dates follow it; switching calendar shows which tasks move before anything changes.
 * My resources follow the home calendar ("Company holidays").
 */
export function PoolHolidays({ client }: { client: { id: string; name: string; holidayCalendarId: string | null } | null }) {
  const queryClient = useQueryClient();
  const calendarsQ = useQuery({ queryKey: ['holiday-calendars'], queryFn: () => apiService.getHolidayCalendars() });
  const calendars = calendarsQ.data?.calendars ?? [];
  const canEdit = !!calendarsQ.data?.canEdit;
  const current = client?.holidayCalendarId || 'home';
  const [pending, setPending] = useState<{ calendarId: string; preview: CalendarChangePreview } | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const propose = async (calendarId: string) => {
    if (!client || calendarId === current) return;
    setError(''); setBusy(true);
    try {
      setPending({ calendarId, preview: await apiService.changeClientCalendar(client.id, calendarId, 'preview') });
    } catch (err) { setError(getApiErrorMessage(err, 'The change could not be checked.')); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!client || !pending) return;
    setBusy(true);
    try {
      await apiService.changeClientCalendar(client.id, pending.calendarId, 'apply');
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: ['project-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['nonWorkingDates'] });
    } catch (err) { setError(getApiErrorMessage(err, 'The calendar could not be changed.')); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!newName.trim()) return;
    setError(''); setBusy(true);
    try {
      const { calendar } = await apiService.createHolidayCalendar(newName.trim());
      setNewName('');
      await queryClient.invalidateQueries({ queryKey: ['holiday-calendars'] });
      if (client) await propose(calendar.id);
    } catch (err) { setError(getApiErrorMessage(err, 'The calendar could not be created.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card-stripe stripe-teal rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-300">
            {client ? `${client.name}'s calendar — its people and projects use it` : 'My resources follow your home calendar'}
          </span>
          {client && canEdit ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              Use calendar
              <select value={current} disabled={busy} onChange={(e) => propose(e.target.value)}
                className="min-h-[40px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 text-sm">
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          ) : (
            <span className="text-lg font-bold text-gray-900 dark:text-white">{calendars.find(c => c.id === current)?.name ?? 'Company holidays'}</span>
          )}
        </div>
        {canEdit && (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
              New calendar
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Ontario 2027" maxLength={120}
                className="min-h-[40px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 text-sm text-gray-900 dark:text-white" />
            </label>
            <button type="submit" disabled={busy || !newName.trim()} className="min-h-[40px] px-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-60">Create</button>
          </form>
        )}
      </div>

      {pending && (
        <div role="alertdialog" aria-label="Change the holiday calendar" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-2">
          <p className="text-sm text-gray-900 dark:text-white">
            Switch {client?.name} to <strong>{calendars.find(c => c.id === pending.calendarId)?.name}</strong>?{' '}
            {pending.preview.tasksMoved > 0
              ? `${pending.preview.tasksMoved} task${pending.preview.tasksMoved === 1 ? '' : 's'} will move to fit the new holidays (each change can be undone in Schedule History).`
              : 'No task dates change.'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={apply} disabled={busy} className="min-h-[40px] px-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-60">Switch calendar</button>
            <button type="button" onClick={() => setPending(null)} disabled={busy} className="min-h-[40px] px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <HolidaysTab calendarId={current} calendarName={calendars.find(c => c.id === current)?.name ?? 'Company holidays'} />
    </div>
  );
}
