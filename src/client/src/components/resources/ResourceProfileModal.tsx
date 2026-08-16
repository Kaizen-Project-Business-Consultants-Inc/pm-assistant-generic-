import { useQuery } from '@tanstack/react-query';
import { X, User, Briefcase, Clock, TrendingUp } from 'lucide-react';
import { apiService } from '../../services/api';
import { UtilizationTrendChart } from './UtilizationTrendChart';

interface ResourceProfileModalProps {
  resourceId: string;
  onClose: () => void;
}

const PROFICIENCY_LABELS: Record<number, string> = {
  1: 'Junior', 2: 'Intermediate', 3: 'Mid', 4: 'Senior', 5: 'Expert',
};

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function ResourceProfileModal({ resourceId, onClose }: ResourceProfileModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['resourceProfile', resourceId],
    queryFn: () => apiService.getResourceProfile(resourceId),
    enabled: !!resourceId,
  });

  const resource = data?.resource;
  const assignments = data?.assignments || [];
  const summary = data?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Resource Profile</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
          </div>
        ) : !resource ? (
          <div className="text-center py-12 text-gray-400">Resource not found.</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-lg font-bold flex-shrink-0">
                {resource.name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">{resource.name}</h3>
                <p className="text-sm text-gray-500">{resource.role}</p>
                <p className="text-xs text-gray-400">{resource.email}</p>
              </div>
            </div>

            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                  <Clock className="w-4 h-4 mx-auto text-blue-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{resource.capacityHoursPerWeek}h</p>
                  <p className="text-[10px] text-gray-500">Capacity/Week</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                  <Briefcase className="w-4 h-4 mx-auto text-purple-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{summary.activeAssignments}</p>
                  <p className="text-[10px] text-gray-500">Assignments</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                  <TrendingUp className="w-4 h-4 mx-auto text-green-500 mb-1" />
                  <p className={`text-lg font-bold ${summary.utilization > 100 ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{summary.utilization}%</p>
                  <p className="text-[10px] text-gray-500">Utilization</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center">
                  <User className="w-4 h-4 mx-auto text-amber-500 mb-1" />
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{resource.costRateHourly != null ? `$${resource.costRateHourly}` : '--'}</p>
                  <p className="text-[10px] text-gray-500">Rate/Hour</p>
                </div>
              </div>
            )}

            {/* Skills */}
            {resource.skills?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Skills</h4>
                <div className="flex flex-wrap gap-1.5">
                  {resource.skills.map((s: { name: string; level: number }, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-700">
                      {s.name} <span className="text-[10px] opacity-70">({PROFICIENCY_LABELS[s.level] || s.level})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Assignments */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Current Assignments</h4>
              {assignments.length === 0 ? (
                <p className="text-sm text-gray-400">No active assignments.</p>
              ) : (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700">
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Task</th>
                        <th className="text-center px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Hours/Wk</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-400">Period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((a: { assignmentId: string; taskName: string; hoursPerWeek: number; startDate: string; endDate: string }) => (
                        <tr key={a.assignmentId} className="border-t border-gray-100 dark:border-gray-700">
                          <td className="px-3 py-2 text-gray-900 dark:text-white">{a.taskName}</td>
                          <td className="px-3 py-2 text-center text-gray-600 dark:text-gray-400">{a.hoursPerWeek}h</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{formatDate(a.startDate)} — {formatDate(a.endDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Utilization Trend Chart */}
            <UtilizationTrendChart resourceId={resourceId} />

            {/* Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {resource.resourceGroup && (
                <div>
                  <span className="text-gray-500">Department:</span>{' '}
                  <span className="text-gray-900 dark:text-white">{resource.resourceGroup}</span>
                </div>
              )}
              <div>
                <span className="text-gray-500">Status:</span>{' '}
                <span className={resource.isActive ? 'text-green-600' : 'text-gray-400'}>{resource.isActive ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700">Close</button>
        </div>
      </div>
    </div>
  );
}
