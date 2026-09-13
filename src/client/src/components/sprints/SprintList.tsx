import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Target, Kanban, BookOpen, ArrowUpDown } from 'lucide-react';
import { apiService } from '../../services/api';

interface SprintTaskStats {
  totalTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
}

interface Sprint {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'completed' | 'cancelled';
  goal?: string;
  start_date?: string;
  end_date?: string;
  velocity_commitment?: number;
  velocity_actual?: number;
  taskStats?: SprintTaskStats;
}

interface SprintListProps {
  projectId: string;
  onSelect: (sprintId: string) => void;
  onCreate: () => void;
  onRetro?: (sprintId: string) => void;
}

type SortMode = 'default' | 'date' | 'name';

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string; darkBg: string; darkText: string }> = {
  planning: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500', label: 'Planning', darkBg: 'dark:bg-purple-900/30', darkText: 'dark:text-purple-300' },
  active: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Active', darkBg: 'dark:bg-blue-900/30', darkText: 'dark:text-blue-300' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500', label: 'Completed', darkBg: 'dark:bg-green-900/30', darkText: 'dark:text-green-300' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-500', label: 'Cancelled', darkBg: 'dark:bg-gray-700', darkText: 'dark:text-gray-300' },
};

const STATUS_ORDER: Record<string, number> = { active: 0, planning: 1, completed: 2, cancelled: 3 };

function formatDate(s?: string): string {
  if (!s) return '--';
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '--';
  }
}

function VelocitySparkline({ sprints }: { sprints: Sprint[] }) {
  const completed = sprints.filter((s) => s.status === 'completed' && s.velocity_actual != null);
  if (completed.length < 2) return null;
  const last = completed.slice(-6);
  const vals = last.map((s) => s.velocity_actual!);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <div className="flex items-center gap-1.5">
      <svg width={w} height={h} className="flex-shrink-0">
        <polyline points={points} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {vals.map((v, i) => (
          <circle key={i} cx={(i / (vals.length - 1)) * w} cy={h - ((v - min) / range) * (h - 4) - 2} r="2" fill="#6366f1" />
        ))}
      </svg>
      <span className="text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">velocity</span>
    </div>
  );
}

export function SprintList({ projectId, onSelect, onCreate, onRetro }: SprintListProps) {
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sprints', projectId],
    queryFn: () => apiService.getSprints(projectId),
  });

  const sprints: Sprint[] = data?.data || data?.sprints || [];

  const sortedSprints = useMemo(() => {
    const copy = [...sprints];
    if (sortMode === 'date') {
      copy.sort((a, b) => {
        const da = a.start_date ? new Date(a.start_date).getTime() : 0;
        const db = b.start_date ? new Date(b.start_date).getTime() : 0;
        return db - da;
      });
    } else if (sortMode === 'name') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      copy.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    }
    return copy;
  }, [sprints, sortMode]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded" />
          <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load sprints.</p>
      </div>
    );
  }

  const cycleSortMode = () => {
    setSortMode((m) => (m === 'default' ? 'date' : m === 'date' ? 'name' : 'default'));
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Kanban className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Sprints</h3>
          <span className="text-xs text-gray-500">({sprints.length})</span>
          <VelocitySparkline sprints={sprints} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cycleSortMode}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={`Sort: ${sortMode}`}
          >
            <ArrowUpDown className="w-3 h-3" />
            <span className="hidden sm:inline capitalize">{sortMode === 'default' ? 'Status' : sortMode}</span>
          </button>
          <button
            onClick={onCreate}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-md transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Sprint</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Sprint cards */}
      {sortedSprints.length === 0 ? (
        <div className="p-8 text-center">
          <Target className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No sprints yet</p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Create your first sprint to start planning.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {sortedSprints.map((sprint) => {
            const cfg = statusConfig[sprint.status] || statusConfig.planning;
            const isActive = sprint.status === 'active';

            return (
              <div
                key={sprint.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(sprint.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sprint.id); } }}
                className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  isActive ? 'bg-blue-50/40 dark:bg-blue-900/10 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{sprint.name}</span>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} ${cfg.darkBg} ${cfg.darkText}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>
                    {sprint.goal && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-1">{sprint.goal}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-500">
                      <span>{formatDate(sprint.start_date)} - {formatDate(sprint.end_date)}</span>
                    </div>
                    {sprint.taskStats && sprint.taskStats.totalTasks > 0 && (() => {
                      const { totalTasks, completedTasks, totalPoints, completedPoints } = sprint.taskStats;
                      const pct = Math.round((completedTasks / totalTasks) * 100);
                      return (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                            <span>{completedTasks}/{totalTasks} tasks done</span>
                            <span>
                              {totalPoints > 0
                                ? `${completedPoints}/${totalPoints} pts`
                                : `${pct}%`}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Velocity + Retro */}
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    {sprint.velocity_commitment != null && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {sprint.velocity_actual ?? '?'}
                        </span>
                        <span className="text-gray-500 dark:text-gray-500"> / {sprint.velocity_commitment} pts</span>
                      </div>
                    )}
                    {sprint.status === 'completed' && onRetro && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRetro(sprint.id); }}
                        aria-label="Generate AI Retrospective"
                        title="Generate AI Retrospective"
                        className="p-1.5 rounded-md text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
