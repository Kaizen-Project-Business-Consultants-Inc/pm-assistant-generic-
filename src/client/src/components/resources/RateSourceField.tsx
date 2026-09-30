import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { fmtDay } from '../schedule/calendar/CalendarChangePreview';
import { cardRateOn, money, nextCardRate, todayYmd } from '../../utils/rateCard';

/**
 * A resource's rate: its own, or the company rate card for its role (dated rates).
 * Shared by the Resources page and a project's Resources tab. People who can't see the
 * rate card (it's pay information) just get the own-rate inputs, as before.
 */
export function RateSourceField({ role, useRateCard, onChange, children }: {
  role: string;
  useRateCard: boolean;
  onChange: (useRateCard: boolean) => void;
  /** The own-rate inputs */
  children: ReactNode;
}) {
  const userRole = useAuthStore(s => s.user?.role);
  const canSeeCard = !!userRole && ['admin', 'project_manager', 'pmo'].includes(userRole);
  const q = useQuery({ queryKey: ['rate-card'], queryFn: () => apiService.getRateCard(), enabled: canSeeCard, retry: false });

  if (!canSeeCard || !q.data) return <>{children}</>;

  const today = todayYmd();
  const current = role.trim() ? cardRateOn(role, today, q.data.rates) : null;
  const next = role.trim() ? nextCardRate(role, today, q.data.rates) : null;
  const radio = 'mt-0.5 h-4 w-4 text-primary-600 border-gray-300 dark:border-gray-600';

  return (
    <fieldset className="col-span-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-2">
      <legend className="px-1 text-xs font-medium text-gray-600 dark:text-gray-400">Cost rate</legend>
      <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
        <input type="radio" name="rate-source" className={radio} checked={useRateCard} onChange={() => onChange(true)} />
        <span className="min-w-0">
          <span className="font-medium">Use rate card</span>
          <span className="block text-xs text-gray-600 dark:text-gray-400">
            {!role.trim()
              ? 'Pick a role first.'
              : current
                ? <>{role.trim()}: <b className="tabular-nums">{money(current.hourlyRate)}/h</b> from {fmtDay(current.effectiveFrom)}{next && <> · {money(next.hourlyRate)}/h from {fmtDay(next.effectiveFrom)}</>}</>
                : next
                  ? <>{role.trim()}: {money(next.hourlyRate)}/h from {fmtDay(next.effectiveFrom)}. Until then, the own rate below is used.</>
                  : <>No rate for {role.trim()} yet — the own rate below is used until you <Link to="/settings?tab=rate-card" className="text-primary-600 dark:text-primary-400 underline">add one to the rate card</Link>.</>}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
        <input type="radio" name="rate-source" className={radio} checked={!useRateCard} onChange={() => onChange(false)} />
        <span className="font-medium">Own rate</span>
      </label>
      <div className="grid grid-cols-2 gap-3 pl-6">{children}</div>
    </fieldset>
  );
}
