import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';

/**
 * Overview card (U17): the critical path in one line — how long, how many tasks set the end
 * date, and when it ends — so it is found without knowing the Gantt switch. With no linked
 * tasks it says how to get one. Same query (and cache) as the Gantt's critical-path switch.
 */
export function CriticalPathCard({ scheduleId, onOpen }: { scheduleId: string; onOpen?: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['criticalPath', scheduleId],
    queryFn: () => apiService.getCriticalPath(scheduleId),
  });
  if (isLoading) return <div className="animate-pulse h-16 bg-gray-200 dark:bg-gray-700 rounded" />;
  if (isError) return <p className="text-sm text-red-600 dark:text-red-400">Could not work out the critical path. Refresh the page to try again.</p>;
  const cpm = data as { projectDuration: number; lengthWorkingDays?: number; criticalPathTaskIds?: string[]; hasLinks?: boolean; finishDate?: string | null } | undefined;
  const open = onOpen && (
    <button type="button" onClick={onOpen} className="text-sm font-semibold text-primary-700 dark:text-primary-300 underline">
      Show it on the Gantt
    </button>
  );
  if (!cpm || cpm.hasLinks === false) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700 dark:text-gray-200">
          No critical path yet: link your tasks first. It is the chain of linked tasks that sets the end date.
        </p>
        {onOpen && (
          <button type="button" onClick={onOpen} className="text-sm font-semibold text-primary-700 dark:text-primary-300 underline">
            Link tasks in the schedule
          </button>
        )}
      </div>
    );
  }
  const critical = cpm.criticalPathTaskIds?.length ?? 0;
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-gray-600 dark:text-gray-300">Length</dt>
          <dd className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{cpm.lengthWorkingDays ?? cpm.projectDuration}<span className="text-sm font-medium"> working days</span></dd>
        </div>
        <div>
          <dt className="text-xs text-gray-600 dark:text-gray-300">Critical tasks</dt>
          <dd className="text-xl font-bold text-red-700 dark:text-red-400 tabular-nums">{critical}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-600 dark:text-gray-300">Ends</dt>
          <dd className="text-sm font-semibold text-gray-900 dark:text-white">{cpm.finishDate ? formatCalendarDate(cpm.finishDate) : '—'}</dd>
        </div>
      </dl>
      <p className="text-xs text-gray-600 dark:text-gray-300">A delay to any critical task delays the whole project.</p>
      {open}
    </div>
  );
}
