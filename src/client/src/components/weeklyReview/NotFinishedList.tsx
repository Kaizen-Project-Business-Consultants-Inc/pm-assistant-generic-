import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { formatCalendarDate } from '../../utils/dateUtils';
import { addCalendarDays } from '../../utils/workingDays';
import { taskStatusLabel } from '../../utils/taskStatus';
import { notFinishedKey } from './weeklyReviewTypes';

/**
 * "Not finished this period": the tasks planned to finish on or before the project's status date that
 * are not Completed. Read-only, for the PM to report. A task is worded by the same rule as the rest of
 * the app (Late once its finish has passed); this list is measured at the close of the status date, so a
 * task due on that very day and still open reads Late here.
 */
export function NotFinishedList({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: notFinishedKey(projectId),
    queryFn: () => apiService.getPmNotFinished(projectId),
    staleTime: 60_000,
  });

  const heading = (
    <h3 id="weekly-not-finished" className="text-xs font-bold tracking-wide text-gray-700 dark:text-gray-300">NOT FINISHED THIS PERIOD</h3>
  );
  const box = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4';

  if (isLoading) {
    return <section aria-labelledby="weekly-not-finished" className={box}>{heading}<Loader2 className="mt-2 w-4 h-4 animate-spin text-primary-600" aria-label="Loading" /></section>;
  }
  if (error || !data) {
    return <section aria-labelledby="weekly-not-finished" className={box}>{heading}<p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error, 'Could not load the unfinished tasks.')}</p></section>;
  }

  const closeOfDay = addCalendarDays(data.asOf, 1) ?? data.asOf;
  const asOfText = formatCalendarDate(data.asOf);

  return (
    <section aria-labelledby="weekly-not-finished" className={box}>
      {heading}
      {data.tasks.length === 0 ? (
        <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">Everything planned to finish by {asOfText} is done.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">Planned to finish by {asOfText} and not Completed. Tasks that finished on time are not listed.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <caption className="sr-only">Tasks planned to finish by {asOfText} that are not Completed</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Task</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Planned finish</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Status</th>
                  <th scope="col" className="py-1.5 font-semibold">Owner</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map(t => {
                  const label = taskStatusLabel({ status: t.status, endDate: t.plannedFinish }, closeOfDay);
                  return (
                    <tr key={t.taskId} className="border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                      <td className="py-2 pr-3">{t.name}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatCalendarDate(t.plannedFinish, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${label === 'Late' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100'}`}>{label}</span>
                      </td>
                      <td className="py-2">{t.owner ?? <span className="text-gray-600 dark:text-gray-300">Not assigned</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.total > data.tasks.length && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">Showing the first {data.tasks.length} of {data.total}.</p>
          )}
        </>
      )}
    </section>
  );
}
