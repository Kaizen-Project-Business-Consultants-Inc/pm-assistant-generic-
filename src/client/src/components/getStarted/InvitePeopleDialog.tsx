import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { COMPANY_ROLE_OPTIONS, usesPaidSeat } from '../../constants/companyRoles';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * Get started step 1 (U48, approved mock 2026-10-19): invite several people at once, each marked
 * Free (Viewer) or Paid seat, with what it does to the bill shown before sending. Uses the same
 * POST /org/invite as Settings → Team (one per person; the server adds seats when needed).
 */
interface Row { email: string; name: string; role: string }
const blankRow = (): Row => ({ email: '', name: '', role: 'team_member' });

type SeatInfo = Awaited<ReturnType<typeof apiService.getSeatInfo>>;

/** "You have 3 seats and use 1. …" — what the paid invites do to the bill */
function seatSummary(seats: SeatInfo, paidInvites: number): string {
  const have = `You have ${seats.paidSeats} seat${seats.paidSeats === 1 ? '' : 's'} and use ${seats.usedSeats}.`;
  if (paidInvites === 0) return `${have} Viewers are free, so your bill doesn't change.`;
  const extra = Math.max(0, paidInvites - seats.availableSeats);
  if (extra === 0) return `${have} These invites fit in your seats, so your bill doesn't change.`;
  const dollars = ((extra * seats.seatPriceCents) / 100).toFixed(2).replace(/\.00$/, '');
  return `${have} These invites add ${extra} seat${extra === 1 ? '' : 's'}: $${dollars} more a month.`;
}

const sendLabel = (n: number) => (n === 0 ? 'Send invites' : `Send ${n} invite${n === 1 ? '' : 's'}`);

export function InvitePeopleDialog({ isOpen, onClose, onInvited }: { isOpen: boolean; onClose: () => void; onInvited: () => void }) {
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [sending, setSending] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  // removing a row removes the focused button: focus goes to "Add another" instead
  const addAnotherRef = useRef<HTMLButtonElement>(null);
  const removeRow = (i: number) => {
    setRows(rs => rs.filter((_, j) => j !== i));
    requestAnimationFrame(() => addAnotherRef.current?.focus());
  };
  const { data: seats } = useQuery({ queryKey: ['seat-info'], queryFn: () => apiService.getSeatInfo(), enabled: isOpen });

  const filled = rows.filter(r => r.email.trim());
  const paidInvites = filled.filter(r => usesPaidSeat(r.role)).length;
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending || filled.length === 0) return;
    setSending(true);
    setFailures([]);
    const failed: string[] = [];
    const left: Row[] = [];
    for (const r of filled) {
      try {
        // one at a time: each may add a seat, and the server checks the company's user limit
        // eslint-disable-next-line no-await-in-loop
        await apiService.inviteOrgMember(r.email.trim(), r.role, r.name.trim() || undefined);
      } catch (err) {
        failed.push(`${r.email.trim()}: ${getApiErrorMessage(err, 'could not be invited')}`);
        left.push(r);
      }
    }
    setSending(false);
    onInvited();
    if (failed.length) {
      setFailures(failed);
      setRows(left);
      return;
    }
    setRows([blankRow()]);
    onClose();
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} labelledBy="invite-people-title" busy={sending}
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-2xl mx-4">
      <form onSubmit={send} className="space-y-4">
        <h2 id="invite-people-title" className="text-lg font-semibold text-gray-900 dark:text-white">Invite your people</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">Viewers are free. Everyone else uses a paid seat.</p>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <fieldset key={i} className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr_auto_auto] gap-2 items-end">
              <legend className="sr-only">Person {i + 1}</legend>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200">Email
                <input type="email" required={i === 0} value={r.email} onChange={e => setRow(i, { email: e.target.value })}
                  className="input mt-1" placeholder="name@company.com" autoComplete="off" />
              </label>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200">Name
                <input type="text" value={r.name} onChange={e => setRow(i, { name: e.target.value })} className="input mt-1" autoComplete="off" />
              </label>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200">Access
                <select value={r.role} onChange={e => setRow(i, { role: e.target.value })} className="input mt-1">
                  {COMPANY_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <span className={`mb-2 text-xs font-semibold rounded-full px-2 py-0.5 whitespace-nowrap ${usesPaidSeat(r.role)
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'}`}>
                {usesPaidSeat(r.role) ? 'Paid seat' : 'Free'}
              </span>
              {rows.length > 1 ? (
                <button type="button" onClick={() => removeRow(i)}
                  className="mb-1 p-1.5 text-gray-500 hover:text-red-600 rounded" aria-label={`Remove person ${i + 1}`}>
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              ) : <span />}
            </fieldset>
          ))}
        </div>

        <button ref={addAnotherRef} type="button" onClick={() => setRows(rs => [...rs, blankRow()])}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add another
        </button>

        {seats?.billingModel === 'per_seat' && (
          <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200" aria-live="polite">
            {seatSummary(seats, paidInvites)}
          </p>
        )}

        {failures.length > 0 && (
          <div role="alert" className="text-sm text-red-700 dark:text-red-400 space-y-1">
            <p className="font-medium">Not sent — the others were:</p>
            {failures.map(f => <p key={f}>{f}</p>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">I&apos;ll invite later</button>
          <button type="submit" disabled={sending || filled.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
            {sending ? 'Sending…' : sendLabel(filled.length)}
          </button>
        </div>
      </form>
    </AccessibleModal>
  );
}
