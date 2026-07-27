import { useQueries } from '@tanstack/react-query';
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService } from '../../../services/api';

interface HealthRecord {
  healthScore: number;
  riskLevel: string;
  scheduleHealth: number | null;
  budgetHealth: number | null;
  riskHealth: number | null;
  recordedAt: string;
}

interface Project {
  id: string;
  name: string;
  status?: string;
  healthScore?: number;
}

interface HealthTrendsWidgetProps {
  projects: Project[];
}

function Sparkline({ data, width = 120, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="text-gray-300 dark:text-gray-600">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth={1} strokeDasharray="4 2" />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padding + ((max - val) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastScore = data[data.length - 1];
  const color = lastScore >= 70 ? '#10b981' : lastScore >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendArrow({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  const diff = current - previous;
  if (diff > 3) return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
  if (diff < -3) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
    : score >= 50 ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
    : 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300';
  return <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{score}</span>;
}

export function HealthTrendsWidget({ projects }: HealthTrendsWidgetProps) {
  // Take top 6 active projects sorted by lowest healthScore (most concerning first)
  const activeProjects = projects
    .filter(p => p.status === 'active' || p.status === 'in_progress' || !p.status)
    .sort((a, b) => (a.healthScore ?? 100) - (b.healthScore ?? 100))
    .slice(0, 6);

  const historyQueries = useQueries({
    queries: activeProjects.map(p => ({
      queryKey: ['health-history', p.id],
      queryFn: () => apiService.getHealthHistory(p.id, 30),
      staleTime: 120_000,
    })),
  });

  const allLoading = historyQueries.every(q => q.isLoading) && activeProjects.length > 0;

  if (allLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Health Trends</h3>
      </div>

      {activeProjects.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">No active projects</p>
      ) : (
        <div className="space-y-2">
          {activeProjects.map((project, idx) => {
            const queryResult = historyQueries[idx];
            const history: HealthRecord[] = queryResult?.data?.data || [];
            const scores = history.map(h => h.healthScore);
            const currentScore = scores.length > 0 ? scores[scores.length - 1] : (project.healthScore ?? 0);
            // Compare to 7 days ago
            const weekAgoIdx = Math.max(0, scores.length - 7);
            const previousScore = scores.length >= 7 ? scores[weekAgoIdx] : null;

            return (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate w-28 flex-shrink-0">
                  {project.name}
                </span>
                <Sparkline data={scores} />
                <ScoreBadge score={currentScore} />
                <TrendArrow current={currentScore} previous={previousScore} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
