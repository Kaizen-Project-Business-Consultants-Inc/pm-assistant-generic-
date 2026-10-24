import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { formatCalendarDate } from '../../utils/dateUtils';

export interface AllowanceCompany {
  id: string;
  name: string;
  billingModel: 'flat' | 'per_seat';
  seatCount: number;
  subscriptionTier: string;
  aiAllowanceOverride: number | null;
  aiAllowanceOverrideAt: string | null;
  aiAllowanceOverrideByName: string | null;
}

const MAX_TOKENS = 10_000_000_000;
const n = (v: number) => v.toLocaleString();

/**
 * A company's own monthly AI allowance (C1). A per-seat company shares one pool; this number replaces
 * the plan's pool for this company only. Anyone else's allowance is each person's own (Admin → Users).
 */
export function CompanyAiAllowanceDialog({ company, onClose }: { company: AllowanceCompany; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(company.aiAllowanceOverride != null ? String(company.aiAllowanceOverride) : '');
  const [error, setError] = useState<string | null>(null);
  const [confirmZero, setConfirmZero] = useState(false);

  // this month's use and the plan default, from the cost report
  const { data } = useQuery({ queryKey: ['admin-ai-usage-companies'], queryFn: () => apiService.getAdminAiUsageByCompany() });
  const row = (data?.companies ?? []).find((c: { id: string }) => c.id === company.id) as
    { tokens: number; planDefault: number; percentUsed: number } | undefined;

  const save = useMutation({
    mutationFn: (override: number | null) => apiService.updateAdminTenant(company.id, { aiAllowanceOverride: override }),
    onSuccess: (_r, override) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-ai-usage-companies'] });
      announce(override == null ? 'Back to the plan allowance' : 'AI allowance saved');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'The allowance could not be saved.')),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.trim().replace(/[,\s]/g, '');
    if (text === '') { save.mutate(null); return; } // blank = the plan default
    if (!/^\d+$/.test(text) || Number(text) > MAX_TOKENS) { setError('Enter a whole number of tokens, up to 10,000,000,000 — or leave it blank for the plan default.'); return; }
    // 0 refuses every AI call for the company: say so, and ask for a second Save
    if (Number(text) === 0 && !confirmZero) {
      setConfirmZero(true);
      setError('0 turns AI off for this company (everyone gets "limit reached"). Press Save again to confirm.');
      return;
    }
    setError(null);
    save.mutate(Number(text));
  };

  const perSeat = row && company.seatCount > 0 ? Math.round(row.planDefault / company.seatCount) : null;
  const input = 'w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100';

  return (
    <AccessibleModal isOpen onClose={onClose} ariaLabel={`AI allowance — ${company.name}`}>
      <form onSubmit={submit} className="p-6 space-y-4 max-w-md">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI allowance — {company.name}</h2>
        </div>

        {company.billingModel !== 'per_seat' ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            This company is billed per person, so each person has their own allowance. Set it for one person on the Users screen.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {row && perSeat != null
                ? <>Plan default: <b>{company.subscriptionTier}</b> {n(perSeat)} per seat × {company.seatCount} seat{company.seatCount === 1 ? '' : 's'} = <b>{n(row.planDefault)}</b> tokens a month.</>
                : 'Loading the plan default…'}
              {row && <> Used this month: <b>{n(row.tokens)}</b> ({row.percentUsed}%).</>}
            </p>
            <div className="space-y-1">
              <label htmlFor="ai-allowance" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                AI allowance for this company (tokens per month)
              </label>
              <input id="ai-allowance" inputMode="numeric" value={value} onChange={e => { setValue(e.target.value); setConfirmZero(false); }}
                placeholder="Blank = the plan default" className={input} aria-describedby="ai-allowance-help" />
              <p id="ai-allowance-help" className="text-xs text-gray-500 dark:text-gray-400">
                This replaces the plan&apos;s shared pool for this company only. Other companies on the same plan are not affected.
                At 80% the company is warned; at 100% AI pauses until the month rolls over or you raise this.
              </p>
            </div>
            {company.aiAllowanceOverride != null && company.aiAllowanceOverrideAt && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Currently {n(company.aiAllowanceOverride)} — set by {company.aiAllowanceOverrideByName ?? 'Kovarti admin'} on{' '}
                {formatCalendarDate(company.aiAllowanceOverrideAt, { year: 'numeric', month: 'short', day: 'numeric' }, 'en-CA')}.
              </p>
            )}
          </>
        )}

        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          {company.billingModel === 'per_seat' && company.aiAllowanceOverride != null ? (
            <button type="button" disabled={save.isPending} onClick={() => save.mutate(null)}
              className="text-sm text-indigo-700 dark:text-indigo-300 underline hover:no-underline disabled:opacity-60">Reset to plan default</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={save.isPending}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
              {company.billingModel === 'per_seat' ? 'Cancel' : 'Close'}
            </button>
            {company.billingModel === 'per_seat' && (
              <button type="submit" disabled={save.isPending}
                className="px-3 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </form>
    </AccessibleModal>
  );
}
