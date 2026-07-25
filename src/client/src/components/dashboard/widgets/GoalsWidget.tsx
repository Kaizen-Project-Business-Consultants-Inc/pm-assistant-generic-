import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { apiService } from '../../../services/api';

interface Goal {
  id: string;
  title: string;
  goalType: string;
  status: string;
  progress: number;
  dueDate?: string;
}

const STATUS_ORDER: Record<string, number> = {
  behind: 0,
  at_risk: 1,
  on_track: 2,
  completed: 3,
};

const STATUS_STYLES: Record<string, string> = {
  behind: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  at_risk: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  on_track: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  completed: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
};

function progressColor(status: string): string {
  if (status === 'behind') return 'bg-red-500';
  if (status === 'at_risk') return 'bg-amber-500';
  if (status === 'completed') return 'bg-blue-500';
  return 'bg-green-500';
}

export function GoalsWidget() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['goals', 'widget'],
    queryFn: () => apiService.listGoals({ goalType: 'objective' }),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-gray-300 dark:text-gray-600" />
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-2 py-1.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="h-3.5 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${60 + i * 10}%` }} />
                <div className="h-4 w-14 bg-gray-100 dark:bg-gray-700/60 rounded" />
              </div>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const goals: Goal[] = (data?.goals || data || [])
    .sort((a: Goal, b: Goal) => {
      const orderDiff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      if (orderDiff !== 0) return orderDiff;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      return 0;
    })
    .slice(0, 6);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Goals</h3>
        </div>
        <Link to="/goals" className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400">
          View All
        </Link>
      </div>

      {goals.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No objectives defined</p>
      ) : (
        <div className="space-y-2.5 max-h-[280px] overflow-y-auto">
          {goals.map(g => {
            const pct = Math.round(g.progress ?? 0);
            const statusLabel = (g.status || 'on_track').replace('_', ' ');
            return (
              <div
                key={g.id}
                onClick={() => navigate('/goals')}
                className="px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate min-w-0">{g.title}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${STATUS_STYLES[g.status] || STATUS_STYLES.on_track}`}>
                      {statusLabel}
                    </span>
                    {g.dueDate && (
                      <span className="text-[10px] text-gray-400">
                        {new Date(g.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className={`${progressColor(g.status)} h-1.5 rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 w-7 text-right">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
