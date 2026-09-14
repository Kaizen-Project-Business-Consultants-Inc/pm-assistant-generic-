import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, BarChart3 } from 'lucide-react';
import { apiService } from '../../services/api';

interface TaskDetail {
  taskId: string;
  taskName: string;
  hoursPlanned: number | null;
  allocationPct: number;
  roleOnTask: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

interface ResourceUsage {
  resourceId: string;
  resourceName: string;
  role: string;
  capacityHoursPerWeek: number;
  totalHoursPlanned: number;
  tasks: TaskDetail[];
}

const STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  on_hold: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  cancelled: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
};

function UtilBar({ planned, capacity }: { planned: number; capacity: number }) {
  if (capacity <= 0) return null;
  const pct = Math.round((planned / capacity) * 100);
  const barWidth = Math.min(pct, 150);
  const color = pct <= 80 ? 'bg-green-500' : pct <= 100 ? 'bg-blue-500' : pct <= 120 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(barWidth, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{planned}h / {capacity}h/wk</span>
    </div>
  );
}

export function ResourceUsageView({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['resource-usage', projectId],
    queryFn: () => apiService.getResourceUsageForProject(projectId),
    enabled: !!projectId,
  });

  const usage: ResourceUsage[] = data?.usage || [];

  const toggle = (resourceId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(resourceId)) next.delete(resourceId); else next.add(resourceId);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-primary-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Resource Usage</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-5 w-5 text-primary-500" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Resource Usage</h3>
        <span className="text-xs text-gray-500 dark:text-gray-500">({usage.length})</span>
      </div>

      {usage.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-500 text-center py-6">
          No task-level resource assignments. Assign resources in the Gantt chart.
        </p>
      ) : (
        <div className="space-y-1">
          {usage.map(r => {
            const isExpanded = expanded.has(r.resourceId);
            return (
              <div key={r.resourceId}>
                {/* Collapsed resource row */}
                <button
                  onClick={() => toggle(r.resourceId)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                      {r.resourceName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{r.resourceName}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">{r.role} &middot; {r.tasks.length} task{r.tasks.length !== 1 ? 's' : ''}</div>
                  </div>
                  <UtilBar planned={r.totalHoursPlanned} capacity={r.capacityHoursPerWeek} />
                </button>

                {/* Expanded task table */}
                {isExpanded && (
                  <div className="ml-14 mr-2 mb-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                          <th className="text-left py-1.5 pr-3 font-medium">Task</th>
                          <th className="text-right py-1.5 px-2 font-medium">Hours</th>
                          <th className="text-right py-1.5 px-2 font-medium">Alloc%</th>
                          <th className="text-left py-1.5 px-2 font-medium">Role</th>
                          <th className="text-left py-1.5 px-2 font-medium">Dates</th>
                          <th className="text-center py-1.5 pl-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.tasks.map(t => (
                          <tr key={t.taskId} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                            <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-100 font-medium">{t.taskName}</td>
                            <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-400">{t.hoursPlanned != null ? `${t.hoursPlanned}h` : '--'}</td>
                            <td className="py-1.5 px-2 text-right text-gray-600 dark:text-gray-400">{t.allocationPct}%</td>
                            <td className="py-1.5 px-2 text-gray-600 dark:text-gray-400">{t.roleOnTask || '--'}</td>
                            <td className="py-1.5 px-2 text-gray-500 dark:text-gray-500 whitespace-nowrap">
                              {t.startDate && t.endDate ? `${t.startDate} – ${t.endDate}` : t.startDate || '--'}
                            </td>
                            <td className="py-1.5 pl-2 text-center">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium capitalize ${STATUS_COLORS[t.status] || STATUS_COLORS.not_started}`}>
                                {t.status.replace(/_/g, ' ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
