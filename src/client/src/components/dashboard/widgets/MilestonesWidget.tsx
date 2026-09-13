import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { apiService } from '../../../services/api';

interface Props {
  scope?: 'portfolio';
}

interface Milestone {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  endDate: string;
  daysUntil: number;
}

export function MilestonesWidget({ scope }: Props) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-milestones', scope],
    queryFn: () => apiService.getDashboardMilestones(scope),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="flex items-center gap-2 mb-3">
          <Flag className="h-4 w-4 text-gray-300 dark:text-gray-600" />
          <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <div className="min-w-0 space-y-1.5">
                <div className="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-20 bg-gray-100 dark:bg-gray-700/60 rounded" />
              </div>
              <div className="h-5 w-12 bg-gray-100 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const milestones: Milestone[] = data?.milestones || [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Flag className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Milestones</h3>
      </div>

      {milestones.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No upcoming milestones</p>
      ) : (
        <ul className="space-y-2">
          {milestones.map((m) => {
            const overdue = m.daysUntil < 0;
            return (
              <li
                key={m.id}
                onClick={() => navigate(`/project/${m.projectId}`)}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.projectName}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">
                    {new Date(m.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${overdue ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400'}`}>
                    {overdue ? `${Math.abs(m.daysUntil)}d late` : `${m.daysUntil}d`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
