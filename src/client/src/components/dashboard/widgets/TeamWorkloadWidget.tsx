import { useQuery, useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Users, AlertTriangle, AlertOctagon } from 'lucide-react';
import { apiService } from '../../../services/api';

interface Project {
  id: string;
  name: string;
}

interface Resource {
  id: string;
  name: string;
  email?: string;
  capacityHoursPerWeek?: number;
}

interface WorkloadEntry {
  resourceId?: string;
  resourceName?: string;
  assignedTasks?: number;
  taskCount?: number;
  projectId?: string;
  projectName?: string;
}

interface Props {
  projects: Project[];
}

export function TeamWorkloadWidget({ projects }: Props) {
  const navigate = useNavigate();

  const { data: resourcesData, isLoading: resLoading } = useQuery({
    queryKey: ['resources', 'widget'],
    queryFn: () => apiService.getResources(),
    staleTime: 120_000,
  });

  const workloadQueries = useQueries({
    queries: projects.slice(0, 10).map(p => ({
      queryKey: ['workload', p.id, 'widget'],
      queryFn: () => apiService.getResourceWorkload(p.id),
      staleTime: 120_000,
    })),
  });

  const isLoading = resLoading || workloadQueries.some(q => q.isLoading);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-gray-300 dark:text-gray-600" />
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-2.5 px-1.5 py-1">
              <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-3 w-6 bg-gray-100 dark:bg-gray-700/60 rounded" />
                </div>
                <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Merge workload across projects
  const tasksByResource = new Map<string, { name: string; tasks: number; projectCount: number; projects: Set<string>; capacity: number | null }>();
  const resources: Resource[] = resourcesData?.resources || resourcesData || [];

  // Seed with resource names + capacity
  for (const r of resources) {
    tasksByResource.set(r.id, { name: r.name, tasks: 0, projectCount: 0, projects: new Set(), capacity: r.capacityHoursPerWeek ?? null });
  }

  for (const q of workloadQueries) {
    const entries: WorkloadEntry[] = q.data?.workload || q.data || [];
    for (const e of entries) {
      const id = e.resourceId || e.resourceName || '';
      if (!id) continue;
      const count = e.assignedTasks ?? e.taskCount ?? 0;
      const existing = tasksByResource.get(id);
      if (existing) {
        existing.tasks += count;
        if (e.projectId || e.projectName) {
          existing.projects.add(e.projectId || e.projectName || '');
        }
      } else {
        const proj = new Set<string>();
        if (e.projectId || e.projectName) proj.add(e.projectId || e.projectName || '');
        tasksByResource.set(id, { name: e.resourceName || id, tasks: count, projectCount: 0, projects: proj, capacity: null });
      }
    }
  }

  // Finalize project counts
  for (const entry of tasksByResource.values()) {
    entry.projectCount = entry.projects.size;
  }

  const sorted = [...tasksByResource.values()]
    .filter(r => r.tasks > 0)
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 8);

  const maxTasks = sorted.length > 0 ? sorted[0].tasks : 1;
  const totalResources = sorted.length;
  const overallocatedCount = sorted.filter(r => r.tasks > 15 || r.projectCount > 2).length;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Team Workload</h3>
      </div>

      {/* Summary stats row */}
      {sorted.length > 0 && (
        <div className="flex items-center gap-3 p-2 mb-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600/50">
          <div className="flex items-center gap-4 text-xs w-full">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-gray-500" />
              <span className="text-gray-500 dark:text-gray-400">Active:</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{totalResources}</span>
            </div>
            {overallocatedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <AlertOctagon className="w-3 h-3 text-red-500" />
                <span className="text-red-600 dark:text-red-400 font-medium">
                  {overallocatedCount} overallocated
                </span>
              </div>
            )}
            {overallocatedCount === 0 && (
              <span className="text-green-600 dark:text-green-400 text-xs font-medium">All balanced</span>
            )}
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No resource data available</p>
      ) : (
        <div className="space-y-2 max-h-[260px] overflow-y-auto">
          {sorted.map(r => {
            const pct = Math.round((r.tasks / maxTasks) * 100);
            const overloaded = r.tasks > 15;
            const multiProject = r.projectCount > 2;
            const hasWarning = overloaded || multiProject;
            return (
              <div
                key={r.name}
                onClick={() => navigate('/resources')}
                className="flex items-center gap-2.5 px-1.5 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${hasWarning ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary-100 dark:bg-primary-900/30'}`}>
                  <span className={`text-xs font-semibold ${hasWarning ? 'text-red-700 dark:text-red-300' : 'text-primary-700 dark:text-primary-300'}`}>
                    {r.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{r.name}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {overloaded && <span title="High task count"><AlertTriangle className="w-3 h-3 text-amber-500" /></span>}
                      {multiProject && <span title={`Spread across ${r.projectCount} projects`}><AlertOctagon className="w-3 h-3 text-red-500" /></span>}
                      <span className={`text-xs font-medium ${hasWarning ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                        {r.tasks}
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className={`${overloaded ? 'bg-red-500' : multiProject ? 'bg-amber-500' : 'bg-primary-500'} h-1.5 rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {(multiProject || r.capacity != null) && (
                    <div className="flex items-center gap-2 mt-0.5">
                      {multiProject && (
                        <span className="text-xs text-amber-500 dark:text-amber-400">{r.projectCount} projects</span>
                      )}
                      {r.capacity != null && r.capacity > 0 && (
                        <span className="text-xs text-gray-500">{r.capacity}h/wk capacity</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
