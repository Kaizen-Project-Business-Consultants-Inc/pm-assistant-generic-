import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pause, Play, AlertCircle, ChevronDown } from 'lucide-react';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function getReportType(templateId: string) {
  if (templateId.startsWith('status-report::')) return 'Status Report';
  if (templateId.startsWith('raid-report::')) return 'RAID Report';
  return 'Custom Report';
}

function getProjectId(templateId: string): string | null {
  if (templateId.startsWith('status-report::')) return templateId.replace('status-report::', '');
  if (templateId.startsWith('raid-report::')) return templateId.replace('raid-report::', '');
  return null;
}

function formatFrequency(s: any) {
  if (s.frequency === 'daily') return `Daily at ${s.timeOfDay || '08:00'}`;
  if (s.frequency === 'weekly') return `Weekly on ${DAY_NAMES[s.dayOfWeek ?? 1]} at ${s.timeOfDay || '08:00'}`;
  return `Monthly on day ${s.dayOfMonth ?? 1} at ${s.timeOfDay || '08:00'}`;
}

type StatusFilter = 'all' | 'active' | 'paused' | 'error';

export function AdminSchedulesPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: schedulesData, isLoading } = useQuery({
    queryKey: ['adminSchedules'],
    queryFn: () => apiService.getAdminReportSchedules(),
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiService.updateReportSchedule(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminSchedules'] }),
  });

  const schedules: any[] = schedulesData?.schedules || [];
  const projects: any[] = projectsData?.data || projectsData?.projects || [];
  const projectNameMap: Record<string, string> = {};
  for (const p of projects) projectNameMap[p.id] = p.name;

  const filtered = schedules.filter(s => {
    if (statusFilter === 'active') return s.isActive && s.lastRunStatus !== 'error';
    if (statusFilter === 'paused') return !s.isActive;
    if (statusFilter === 'error') return s.lastRunStatus === 'error';
    return true;
  });

  return (
    <AdminPageWrapper title="Scheduled Reports" subtitle="View and manage all scheduled reports across users">
      {/* Filter */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</label>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
            className="input text-xs py-1.5 pr-7 appearance-none"
          >
            <option value="all">All ({schedules.length})</option>
            <option value="active">Active ({schedules.filter((s: any) => s.isActive && s.lastRunStatus !== 'error').length})</option>
            <option value="paused">Paused ({schedules.filter((s: any) => !s.isActive).length})</option>
            <option value="error">Errors ({schedules.filter((s: any) => s.lastRunStatus === 'error').length})</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <CalendarClock className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {schedules.length === 0 ? 'No scheduled reports exist yet.' : 'No schedules match this filter.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Creator</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Report</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Project</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Frequency</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Next Run</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Run</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {filtered.map((s: any) => {
                  const pid = getProjectId(s.templateId);
                  return (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-600 dark:text-gray-300 truncate max-w-[120px] block">{s.createdBy?.slice(0, 8)}...</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{getReportType(s.templateId)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{pid ? (projectNameMap[pid] || pid.slice(0, 8) + '...') : '—'}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-600 dark:text-gray-300">{formatFrequency(s)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{s.isActive ? formatDate(s.nextRunAt) : 'Paused'}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatDate(s.lastRunAt)}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {s.lastRunStatus === 'error' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400" title={s.lastRunError || 'Error'}>
                            <AlertCircle className="w-3 h-3" />
                            Error
                          </span>
                        ) : s.lastRunStatus === 'success' ? (
                          <span className="text-xs text-green-600 dark:text-green-400">Success</span>
                        ) : !s.isActive ? (
                          <span className="text-xs text-amber-500">Paused</span>
                        ) : (
                          <span className="text-xs text-gray-400">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => toggleMutation.mutate({ id: s.id, isActive: !s.isActive })}
                          className="p-1.5 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                          title={s.isActive ? 'Pause' : 'Resume'}
                        >
                          {s.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminPageWrapper>
  );
}
