import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { apiService } from '../../services/api';

interface Epic {
  id: string;
  name: string;
  status: string;
  childCount: number;
  completedChildCount: number;
  progress: number;
  totalPoints: number;
  completedPoints: number;
  startDate: string | null;
  endDate: string | null;
}

interface EpicChild {
  id: string;
  name: string;
  status: string;
  priority: string;
  taskType: string;
  assignedTo: string | null;
  storyPoints: number;
  startDate: string | null;
  endDate: string | null;
}

const statusBadge: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  on_hold: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
};

function getStatusStyle(status: string) {
  return statusBadge[status] || statusBadge.pending;
}

function EpicCard({ epic, scheduleId }: { epic: Epic; scheduleId: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data: childrenData, isLoading: childrenLoading } = useQuery({
    queryKey: ['epic-children', scheduleId, epic.id],
    queryFn: () => apiService.getEpicChildren(scheduleId, epic.id),
    enabled: expanded,
  });

  const children: EpicChild[] = childrenData?.children || [];
  const style = getStatusStyle(epic.status);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="border-l-4 border-purple-500 p-4">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">{epic.name}</h4>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
            {epic.status.replace('_', ' ')}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{epic.progress}% complete</span>
          </div>
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${epic.progress === 100 ? 'bg-green-500' : epic.progress >= 50 ? 'bg-purple-500' : 'bg-purple-400'}`}
              style={{ width: `${epic.progress}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span>{epic.completedChildCount}/{epic.childCount} stories</span>
          <span>{epic.completedPoints}/{epic.totalPoints} pts</span>
        </div>

        {/* Expand toggle */}
        {epic.childCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? 'Hide' : 'Show'} tasks
          </button>
        )}
      </div>

      {/* Children list */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {childrenLoading ? (
            <div className="p-3 text-center">
              <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : children.length === 0 ? (
            <p className="p-3 text-xs text-gray-400 text-center">No child tasks</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {children.map((child) => {
                const cs = getStatusStyle(child.status);
                return (
                  <li key={child.id} className="px-4 py-2 flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cs.dot}`} />
                    <span className="text-gray-800 dark:text-gray-200 truncate flex-1">{child.name}</span>
                    {child.storyPoints > 0 && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded font-medium">
                        {child.storyPoints}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EpicBoard({ scheduleId }: { scheduleId: string }) {
  const [statusFilter, setStatusFilter] = useState('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['epics', scheduleId],
    queryFn: () => apiService.getEpics(scheduleId),
    enabled: !!scheduleId,
  });

  const epics: Epic[] = data?.epics || [];

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return epics;
    return epics.filter((e) => e.status === statusFilter);
  }, [epics, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-300">
        Failed to load epics
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-purple-500" />
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Epic Board</h4>
          <span className="text-xs text-gray-500 dark:text-gray-400">({filtered.length} epic{filtered.length !== 1 ? 's' : ''})</span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-1.5 text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-8 text-center">
          <Layers className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No epics found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((epic) => (
            <EpicCard key={epic.id} epic={epic} scheduleId={scheduleId} />
          ))}
        </div>
      )}
    </div>
  );
}
