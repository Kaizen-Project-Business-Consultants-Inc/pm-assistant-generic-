import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { SCurveChart } from './SCurveChart';

/**
 * The schedule's progress view for waterfall projects: planned value against earned
 * value and actual cost, added up over time. It takes the place of Burndown, which is
 * an Agile (fixed sprint scope) chart. Same data and cache as the Performance panel.
 */
export function SCurveView({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sCurve', projectId],
    queryFn: () => apiService.getSCurveData(projectId),
    enabled: !!projectId,
  });
  const points: Array<{ date: string; pv: number; ev: number; ac: number }> = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  const hasValues = points.some(p => p.pv > 0 || p.ev > 0 || p.ac > 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">S-curve</h3>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 max-w-prose">
          Planned value, earned value and actual cost, added up over time. When earned value runs below planned, the project is behind; when actual cost runs above earned value, it is over budget.
        </p>
      </div>
      {isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load the S-curve. Refresh the page to try again.</p>}
      {!isLoading && !isError && (hasValues
        ? <SCurveChart data={points} />
        : <p className="text-sm text-gray-600 dark:text-gray-300 rounded-md border border-dashed border-gray-300 dark:border-gray-600 px-4 py-6 text-center">
            The S-curve needs task budgets. Give tasks a <b>Budget</b> (Table view → Columns → Cost) and record actual cost as work is done.
          </p>)}
    </div>
  );
}
