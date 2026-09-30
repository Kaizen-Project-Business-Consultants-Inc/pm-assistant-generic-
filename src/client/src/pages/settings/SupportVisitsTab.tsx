import { useQuery } from '@tanstack/react-query';
import { Eye, Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * Every time Kovarti support looked at this company's workspace (Support view): when, for how
 * long, and why. Visits are read-only — support can never change your data. Company owner / PMO.
 */
function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function minutes(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
}

export function SupportVisitsTab() {
  const q = useQuery({ queryKey: ['support-visits'], queryFn: () => apiService.getSupportVisits(), retry: false });
  const visits = q.data?.visits ?? [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Eye className="w-5 h-5 text-amber-600" aria-hidden="true" /> Support visits
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-prose">
          Each time Kovarti support looked at your workspace to help with a problem. Visits are <b>read-only</b> — support can see your
          projects but can never change anything — and each one lasts at most 30 minutes.
        </p>
      </div>

      {q.isLoading && <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> Loading…</p>}
      {q.isError && <p className="text-sm text-red-600 dark:text-red-400">{getApiErrorMessage(q.error, 'Could not load the support visits.')}</p>}
      {q.data && visits.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Support has never looked at your workspace.</p>}

      {visits.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-semibold">When</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">How long</th>
                <th scope="col" className="px-3 py-2 text-left font-semibold">Reason given</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-gray-900 dark:text-gray-100">
              {visits.map(v => (
                <tr key={v.id}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{when(v.startedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {v.active
                      ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Happening now</span>
                      : `${minutes(v.startedAt, v.endedAt ?? v.expiresAt)} min`}
                  </td>
                  <td className="px-3 py-2 min-w-0 break-words">{v.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
