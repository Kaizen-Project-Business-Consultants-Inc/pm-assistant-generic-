import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { apiService } from '../../services/api';
import { routeTo } from '../../routes';

const OPEN_CLASS = (open: number, rag: string) =>
  open === 0 ? 'text-green-700 dark:text-green-300'
  : rag === 'red' ? 'text-red-700 dark:text-red-300'
  : 'text-amber-700 dark:text-amber-300';

/**
 * Dashboard: "This week's reviews" — the Weekly PM review of each project the user manages,
 * projects that need them first. Shows nothing for people who manage no reviewed project.
 */
export function MyWeeklyReviews() {
  const { data } = useQuery({
    queryKey: ['pm-weekly-reviews-mine'],
    queryFn: async () => (await apiService.getMyPmWeeklyReviews()).reviews,
    staleTime: 5 * 60_000,
  });
  if (!data || data.length === 0) return null;

  return (
    <section aria-labelledby="my-weekly-reviews" className="rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardCheck className="w-5 h-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h2 id="my-weekly-reviews" className="text-sm font-semibold text-gray-900 dark:text-gray-100">This week's reviews</h2>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
        {data.map(r => (
          <li key={r.projectId}>
            <Link
              to={routeTo.project(r.projectId, 'weekly-review')}
              className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded px-1"
            >
              <span className="text-gray-800 dark:text-gray-100 truncate">{r.projectName}</span>
              <strong className={`flex-shrink-0 ${OPEN_CLASS(r.open, r.rag)}`}>
                {r.open > 0 ? `${r.open} decision${r.open === 1 ? '' : 's'}` : 'All fine'}
              </strong>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
