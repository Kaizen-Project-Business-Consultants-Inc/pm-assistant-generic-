import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

const agentLabels: Record<string, string> = {
  auto_reschedule: 'Auto-Reschedule',
  budget: 'Budget',
  monte_carlo: 'Monte Carlo',
  meeting: 'Meeting',
};

const resultBadgeColors: Record<string, string> = {
  alert_created: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  skipped: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
  error: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
};

export function AgentActivityTab({ projectId }: { projectId: string }) {
  const [agentFilter, setAgentFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const limit = 25;
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const canTriggerScan = user?.role === 'admin' || user?.role === 'project_manager' || user?.role === 'pmo';

  const scanMutation = useMutation({
    mutationFn: () => apiService.triggerAgentScan(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentActivityLog', projectId] });
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['agentActivityLog', projectId, agentFilter, page],
    queryFn: () => apiService.getAgentActivityLog(projectId, limit, page * limit, agentFilter || undefined),
    enabled: !!projectId,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Agent Activity Log</h3>
        <div className="flex items-center gap-3">
          {canTriggerScan && (
            <button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="h-3.5 w-3.5" />
              {scanMutation.isPending ? 'Running…' : 'Run AI Analysis'}
            </button>
          )}
          {scanMutation.isError && (
            <span className="text-xs text-red-600">Scan failed</span>
          )}
          {scanMutation.isSuccess && !scanMutation.isPending && (
            <span className="text-xs text-green-600">Scan complete</span>
          )}
          <select
            value={agentFilter}
            onChange={(e) => { setAgentFilter(e.target.value); setPage(0); }}
            className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">All Agents</option>
            <option value="auto_reschedule">Auto-Reschedule</option>
            <option value="budget">Budget</option>
            <option value="monte_carlo">Monte Carlo</option>
            <option value="meeting">Meeting</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">Loading agent activity…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500">No agent activity recorded yet</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Time</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Agent</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Result</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {entries.map((entry: any) => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap font-medium text-gray-700 dark:text-gray-200">
                      {agentLabels[entry.agentName] || entry.agentName}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${resultBadgeColors[entry.result] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                        {entry.result === 'alert_created' ? 'Alert Created' : entry.result === 'skipped' ? 'Skipped' : 'Error'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-300">{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
