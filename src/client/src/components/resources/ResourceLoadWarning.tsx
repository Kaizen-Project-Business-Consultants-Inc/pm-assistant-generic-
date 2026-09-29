import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiService } from '../../services/api';
import { describeOverload, type LoadCheckResult } from '../../utils/resourceLoad';

interface Props {
  resourceId: string;
  startDate: string;
  endDate: string;
  allocationPct: number;
  /** The task being edited — its current booking isn't counted twice */
  excludeTaskId?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Warns (never blocks) when putting this person on this task, for these dates, at this %, would
 * take them over 100% in some week — the Workload Heatmap's numbers. Re-checks as the person,
 * % or dates change (debounced).
 */
export function ResourceLoadWarning({ resourceId, startDate, endDate, allocationPct, excludeTaskId }: Props) {
  const params = { resourceId, startDate: startDate.slice(0, 10), endDate: endDate.slice(0, 10), allocationPct, excludeTaskId };
  const key = JSON.stringify(params);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 400);
    return () => clearTimeout(t);
  }, [key]);

  const ready = !!resourceId && DAY.test(params.startDate) && DAY.test(params.endDate) && allocationPct > 0;
  const { data } = useQuery({
    queryKey: ['load-check', debounced],
    queryFn: () => apiService.checkResourceLoad(JSON.parse(debounced)),
    enabled: ready && debounced === key,
    staleTime: 30_000,
    retry: false,
  });
  const text = ready ? describeOverload(data as LoadCheckResult | undefined) : null;
  if (!text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-1 flex items-start gap-1.5 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-200"
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {text}{' '}
        {/* New tab: the form being filled in stays open */}
        <a href="/resources?tab=workload" target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100">See Workload Heatmap</a>
      </span>
    </div>
  );
}
