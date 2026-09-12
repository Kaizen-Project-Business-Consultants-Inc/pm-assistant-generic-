import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiService } from '../../../services/api';

export function PrioritiesStripWidget() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => apiService.getAnalyticsSummary(),
    staleTime: 120_000,
  });

  if (isLoading) return null;

  const atRisk: Array<{ id: string; name: string; reason: string }> =
    analytics?.portfolio?.atRiskProjects || [];

  if (atRisk.length === 0) {
    return (
      <div className="card flex items-center gap-3 py-4">
        <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          All projects on track
        </span>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Today's Priorities
        </h3>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 scrollbar-thin">
        {atRisk.map((project) => (
          <Link
            key={project.id}
            to={`/project/${project.id}`}
            className="min-w-[220px] max-w-[280px] shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${reasonColor(project.reason)}`} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {project.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                  {project.reason}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function reasonColor(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes('budget') || lower.includes('cost') || lower.includes('overrun'))
    return 'text-red-500';
  if (lower.includes('schedule') || lower.includes('delay') || lower.includes('overdue'))
    return 'text-amber-500';
  if (lower.includes('risk'))
    return 'text-orange-500';
  return 'text-amber-500';
}
