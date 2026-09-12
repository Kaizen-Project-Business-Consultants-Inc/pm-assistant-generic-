import { useQueries } from '@tanstack/react-query';
import { Zap, TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiService } from '../../../services/api';

interface Project {
  id: string;
  name: string;
  status?: string;
  methodology?: string;
}

interface VelocitySparklineWidgetProps {
  projects: Project[];
}

interface SprintVelocity {
  name: string;
  velocity: number;
  commitment: number;
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

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke="#6366f1"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrendArrow({ values }: { values: number[] }) {
  if (values.length < 2) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  const recent = values[values.length - 1];
  const previous = values[values.length - 2];
  const diff = recent - previous;
  if (diff > 1) return <TrendingUp className="w-3.5 h-3.5 text-green-500" />;
  if (diff < -1) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
}

function SprintDelta({ current, previous }: { current: number; previous: number }) {
  const diff = current - previous;
  const pct = previous > 0 ? Math.round((diff / previous) * 100) : 0;
  if (diff === 0) return null;
  const positive = diff > 0;
  return (
    <span className={`text-[10px] font-medium ${positive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
      {positive ? '+' : ''}{pct}%
    </span>
  );
}

function CommitmentRatio({ velocity, commitment }: { velocity: number; commitment: number }) {
  if (commitment <= 0) return null;
  const ratio = Math.round((velocity / commitment) * 100);
  const color = ratio >= 90 ? 'text-green-600 dark:text-green-400' : ratio >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${color}`} title={`Delivered ${velocity} of ${commitment} committed`}>
      <Target className="w-2.5 h-2.5" />
      {ratio}%
    </span>
  );
}

export function VelocitySparklineWidget({ projects }: VelocitySparklineWidgetProps) {
  // Only agile/hybrid projects have meaningful velocity data
  const agileProjects = projects
    .filter(p =>
      (p.methodology === 'agile' || p.methodology === 'hybrid') &&
      (p.status === 'active' || p.status === 'in_progress' || !p.status)
    )
    .slice(0, 8);

  const velocityQueries = useQueries({
    queries: agileProjects.map(p => ({
      queryKey: ['velocity-history', p.id],
      queryFn: () => apiService.getVelocityHistory(p.id),
      staleTime: 120_000,
    })),
  });

  const allLoading = velocityQueries.every(q => q.isLoading) && agileProjects.length > 0;

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

  // Filter to projects that actually have velocity data
  const projectsWithData: { project: Project; sprints: SprintVelocity[]; avg: number }[] = [];
  for (let i = 0; i < agileProjects.length; i++) {
    const result = velocityQueries[i];
    const raw = result?.data?.velocity ?? result?.data;
    const sprints: SprintVelocity[] = raw?.sprints ?? [];
    if (sprints.length > 0) {
      const velocities = sprints.map(s => s.velocity);
      const avg = Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length);
      projectsWithData.push({ project: agileProjects[i], sprints, avg });
    }
  }

  if (agileProjects.length === 0) {
    return null; // Don't show widget if no agile projects
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Sprint Velocity</h3>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">pts/sprint</span>
      </div>

      {projectsWithData.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
          {agileProjects.length > 0 ? 'No completed sprints yet' : 'No agile projects'}
        </p>
      ) : (
        <div className="space-y-2">
          {/* Portfolio aggregate */}
          {projectsWithData.length > 1 && (() => {
            const totalCurrent = projectsWithData.reduce((sum, p) => {
              const v = p.sprints[p.sprints.length - 1]?.velocity ?? 0;
              return sum + v;
            }, 0);
            const totalPrevious = projectsWithData.reduce((sum, p) => {
              const v = p.sprints.length >= 2 ? p.sprints[p.sprints.length - 2]?.velocity ?? 0 : 0;
              return sum + v;
            }, 0);
            // Aggregate velocity per sprint index across projects
            const maxLen = Math.max(...projectsWithData.map(p => p.sprints.length));
            const aggregated: number[] = [];
            for (let i = 0; i < maxLen; i++) {
              let sum = 0;
              for (const p of projectsWithData) {
                if (i < p.sprints.length) sum += p.sprints[i].velocity;
              }
              aggregated.push(sum);
            }
            return (
              <div className="flex items-center gap-3 p-2 rounded-lg bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30">
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 w-28 flex-shrink-0">
                  Portfolio
                </span>
                <Sparkline data={aggregated} />
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200">
                  {totalCurrent}
                </span>
                <TrendArrow values={aggregated} />
                {totalPrevious > 0 && <SprintDelta current={totalCurrent} previous={totalPrevious} />}
              </div>
            );
          })()}
          {projectsWithData.map(({ project, sprints, avg }) => {
            const velocities = sprints.map(s => s.velocity);
            const lastSprint = sprints[sprints.length - 1];
            const prevSprint = sprints.length >= 2 ? sprints[sprints.length - 2] : null;
            return (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate w-28 flex-shrink-0">
                  {project.name}
                </span>
                <Sparkline data={velocities} />
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                  {avg}
                </span>
                <TrendArrow values={velocities} />
                {prevSprint && <SprintDelta current={lastSprint.velocity} previous={prevSprint.velocity} />}
                <CommitmentRatio velocity={lastSprint.velocity} commitment={lastSprint.commitment} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
