import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { apiService } from '../../../services/api';

export function ResourceUtilizationWidget() {
  const { data: resourcesData, isLoading } = useQuery({
    queryKey: ['resources', 'widget'],
    queryFn: () => apiService.getResources(),
  });

  const resources = resourcesData?.resources || [];

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-full bg-gray-100 dark:bg-gray-700 rounded" />)}
        </div>
      </div>
    );
  }

  const activeResources = resources.filter((r: any) => r.isActive);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Resources</h3>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{activeResources.length} active</span>
      </div>

      {activeResources.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No resources configured</p>
      ) : (
        <div className="space-y-2 max-h-[240px] overflow-y-auto">
          {activeResources.slice(0, 8).map((r: any) => (
            <div key={r.id} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 flex items-center justify-center text-[10px] font-bold shrink-0">
                {(r.name || '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{r.name}</p>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{r.role || 'No role'}</p>
              </div>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">{r.capacityHoursPerWeek || 40}h/wk</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
