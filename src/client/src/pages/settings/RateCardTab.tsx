import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { apiService, type RateCardEntry, type RateInput } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { fmtDay } from '../../components/schedule/calendar/CalendarChangePreview';
import { RESOURCE_ROLES } from '../../constants/resourceRoles';
import { cardRateOn, money, roleKey, todayYmd } from '../../utils/rateCard';

/**
 * Rate card: hourly cost rates by role, each starting on a date. Resources set to "Use
 * rate card" are costed at their role's rate for the week the work happened, so a raise
 * from 1 October leaves September's cost alone. Admins, PMO and project managers (and the
 * company owner) see and change it; the tab is hidden from everyone else.
 */
interface Form { id: string | null; role: string; hourly: string; overtime: string; from: string }
const EMPTY = (): Form => ({ id: null, role: '', hourly: '', overtime: '', from: todayYmd() });

export function RateCardTab() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['rate-card'], queryFn: () => apiService.getRateCard(), retry: false });
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const rates = q.data?.rates ?? [];
  const today = todayYmd();
  const byRole = rates.reduce<Record<string, { role: string; list: RateCardEntry[] }>>((acc, r) => {
    (acc[roleKey(r.role)] ??= { role: r.role, list: [] }).list.push(r);
    return acc;
  }, {});
  const roleOptions = [...new Set([...RESOURCE_ROLES, ...rates.map(r => r.role)])].sort();

  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setError(null); };

  const save = async () => {
    setDone(null);
    const hourly = parseFloat(form.hourly);
    const overtime = form.overtime.trim() ? parseFloat(form.overtime) : null;
    if (!form.role.trim()) { setError('Enter the role this rate is for.'); return; }
    if (!Number.isFinite(hourly) || hourly < 0) { setError('Enter the hourly rate as a number, e.g. 95.'); return; }
    if (overtime != null && (!Number.isFinite(overtime) || overtime < 0)) { setError('Enter the overtime rate as a number, or leave it empty.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.from)) { setError('Pick the date this rate starts.'); return; }
    const input: RateInput = { role: form.role.trim(), hourlyRate: hourly, overtimeRate: overtime, effectiveFrom: form.from };
    setSaving(true);
    try {
      if (form.id) await apiService.updateRate(form.id, input);
      else await apiService.addRate(input);
      const msg = `Saved. ${input.role}: ${money(hourly)}/h from ${fmtDay(form.from)}.`;
      setDone(msg); announce(msg);
      setForm(EMPTY());
      await queryClient.invalidateQueries({ queryKey: ['rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['workload'] });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save the rate. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: RateCardEntry) => {
    setConfirmDelete(null); setDone(null);
    try {
      await apiService.deleteRate(r.id);
      const msg = `Removed ${r.role}'s rate from ${fmtDay(r.effectiveFrom)}.`;
      setDone(msg); announce(msg);
      await queryClient.invalidateQueries({ queryKey: ['rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['workload'] });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not remove the rate. Please try again.'));
    }
  };

  const edit = (r: RateCardEntry) => {
    setDone(null); setError(null);
    setForm({ id: r.id, role: r.role, hourly: String(r.hourlyRate), overtime: r.overtimeRate != null ? String(r.overtimeRate) : '', from: r.effectiveFrom });
  };

  const input = 'px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Rate card</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-prose">
            Hourly cost rates by role. When a rate changes, add a new line with the date it starts — work before that date keeps the old rate.
            A resource uses these rates when its form is set to <b>Use rate card</b>; otherwise it keeps its own rate.
          </p>
        </div>

        {q.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
        {q.isError && <p className="text-sm text-red-600 dark:text-red-400">{getApiErrorMessage(q.error, 'Could not load the rate card. Refresh the page to try again.')}</p>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}
        {done && <p role="status" className="text-sm text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">{done}</p>}

        {q.data && rates.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No rates yet. Add the first one below.</p>}

        {rates.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Role</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Hourly</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Overtime</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">From</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {Object.values(byRole).sort((a, b) => a.role.localeCompare(b.role)).flatMap(({ list }) => {
                  const current = cardRateOn(list[0].role, today, list);
                  return list.map(r => {
                    const status = r.id === current?.id ? 'current' : r.effectiveFrom > today ? 'upcoming' : 'past';
                    return (
                      <tr key={r.id} className={status === 'past' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}>
                        <td className="px-3 py-2">{r.role}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.hourlyRate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.overtimeRate != null ? money(r.overtimeRate) : <span className="text-gray-500 dark:text-gray-400" title="1.5 × the hourly rate">{money(r.hourlyRate * 1.5)}*</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="tabular-nums">{fmtDay(r.effectiveFrom)}</span>
                          {status === 'current' && <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">Current</span>}
                          {status === 'upcoming' && <span className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">Upcoming</span>}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {confirmDelete === r.id ? (
                            <span className="inline-flex items-center gap-2 text-xs">
                              Remove?
                              <button type="button" onClick={() => remove(r)} className="font-semibold text-red-700 dark:text-red-300 hover:underline">Yes</button>
                              <button type="button" onClick={() => setConfirmDelete(null)} className="text-gray-600 dark:text-gray-300 hover:underline">No</button>
                            </span>
                          ) : (
                            <>
                              <button type="button" onClick={() => edit(r)} disabled={saving} aria-label={`Change ${r.role}'s rate from ${fmtDay(r.effectiveFrom)}`} title="Change"
                                className="p-1 rounded text-gray-500 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => setConfirmDelete(r.id)} disabled={saving} aria-label={`Remove ${r.role}'s rate from ${fmtDay(r.effectiveFrom)}`} title="Remove"
                                className="p-1 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">* No overtime rate entered: 1.5 × the hourly rate.</p>
          </div>
        )}

        {q.data && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-col gap-1 flex-1 min-w-[10rem]">
              <label htmlFor="rc-role" className="text-xs font-medium text-gray-700 dark:text-gray-300">Role</label>
              <input id="rc-role" list="rc-roles" value={form.role} onChange={e => set({ role: e.target.value })} disabled={saving} maxLength={100}
                placeholder="e.g. Developer" className={input} />
              <datalist id="rc-roles">{roleOptions.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div className="flex flex-col gap-1 w-28">
              <label htmlFor="rc-hourly" className="text-xs font-medium text-gray-700 dark:text-gray-300">Hourly ($)</label>
              <input id="rc-hourly" type="number" min="0" step="0.01" value={form.hourly} onChange={e => set({ hourly: e.target.value })} disabled={saving} className={input} />
            </div>
            <div className="flex flex-col gap-1 w-28">
              <label htmlFor="rc-ot" className="text-xs font-medium text-gray-700 dark:text-gray-300">Overtime ($)</label>
              <input id="rc-ot" type="number" min="0" step="0.01" value={form.overtime} onChange={e => set({ overtime: e.target.value })} disabled={saving}
                placeholder="1.5×" className={input} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="rc-from" className="text-xs font-medium text-gray-700 dark:text-gray-300">From</label>
              <input id="rc-from" type="date" value={form.from} onChange={e => set({ from: e.target.value })} disabled={saving} className={input} />
            </div>
            <button type="button" onClick={save} disabled={saving}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
              {saving ? 'Saving…' : form.id ? 'Save changes' : '+ Add rate'}
            </button>
            {form.id && (
              <button type="button" onClick={() => { setForm(EMPTY()); setError(null); }} disabled={saving}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
