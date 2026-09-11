import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, ChevronUp, Users, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { apiService } from '../../services/api';

interface WeeklyReview {
  projectId: string;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  hoursByUser: { userId: string; userName: string; hours: number }[];
  anomalyCount: number;
  compliancePercent: number;
  topTasks: { taskId: string; taskName: string; hours: number }[];
  overBudgetTasks: { taskId: string; taskName: string; estimatedHours: number; actualHours: number; overBy: number }[];
}

function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function WeeklyReviewPanel({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [weekStart, setWeekStart] = useState(getMonday);

  const { data, isLoading } = useQuery({
    queryKey: ['weekly-review', projectId, weekStart],
    queryFn: () => apiService.getWeeklyReview(projectId, weekStart),
    staleTime: 5 * 60_000,
  });

  const review: WeeklyReview | null = data?.review || null;

  if (isLoading) return null;
  if (!review || review.totalHours === 0) return null;

  const maxUserHours = Math.max(...review.hoursByUser.map(u => u.hours), 1);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            Weekly Review
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Week of {weekStart}
          </span>
          <div className="flex items-center gap-2 ml-2">
            <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
              {review.totalHours.toFixed(1)}h
            </span>
            <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
              review.compliancePercent >= 80 ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
              review.compliancePercent >= 50 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' :
              'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
            }`}>
              {review.compliancePercent}% compliant
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={weekStart}
            onChange={(e) => { e.stopPropagation(); setWeekStart(e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
          />
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-5 space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <Users className="w-4 h-4 text-primary-500" />
              <div>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{review.hoursByUser.length}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Contributors</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <BarChart3 className="w-4 h-4 text-blue-500" />
              <div>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{review.totalHours.toFixed(1)}h</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Hours</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <div>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{review.anomalyCount}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Anomalies</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <div>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{review.compliancePercent}%</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Compliance</p>
              </div>
            </div>
          </div>

          {/* Hours by team member */}
          {review.hoursByUser.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">Hours by Team Member</h4>
              <div className="space-y-2">
                {review.hoursByUser.map(u => (
                  <div key={u.userId} className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 dark:text-gray-300 w-32 truncate">{u.userName}</span>
                    <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all"
                        style={{ width: `${Math.min((u.hours / maxUserHours) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white w-14 text-right">{u.hours.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top tasks */}
          {review.topTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2">Top Tasks by Hours</h4>
              <div className="space-y-1">
                {review.topTasks.slice(0, 5).map(t => (
                  <div key={t.taskId} className="flex items-center justify-between text-sm py-1">
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[70%]">{t.taskName}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{t.hours.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Over-budget tasks */}
          {review.overBudgetTasks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-red-500" /> Over-Budget Tasks
              </h4>
              <div className="space-y-1">
                {review.overBudgetTasks.map(t => (
                  <div key={t.taskId} className="flex items-center justify-between text-sm py-1">
                    <span className="text-gray-700 dark:text-gray-300 truncate max-w-[50%]">{t.taskName}</span>
                    <div className="text-right">
                      <span className="text-red-600 dark:text-red-400 font-medium">{t.actualHours.toFixed(1)}h</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-gray-500">{t.estimatedHours.toFixed(1)}h est.</span>
                      <span className="ml-2 text-xs text-red-500 font-medium">+{t.overBy.toFixed(1)}h</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
