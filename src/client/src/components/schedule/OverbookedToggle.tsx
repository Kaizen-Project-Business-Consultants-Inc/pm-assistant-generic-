import { ToggleButton, TOGGLE_BADGE_CLASS } from '../ui/ToggleButton';
import { useCanOpenPage } from '../../hooks/useCanOpenPage';
import { ROUTES } from '../../routes';

/**
 * The "Overbooked people" button on the Gantt, Table and Kanban toolbars (U65, approved mock
 * https://claude.ai/artifact/D94EMU7a1MfJDvcQPMjeGk; it was "Conflicts", on the Gantt only). On,
 * it marks tasks that book someone over 100% in a week and shows how many; beside it, a link to the
 * Workload Heatmap — or, when no task has a person, says there is nothing to check.
 */
export function OverbookedToggle({ on, onToggle, count, anyoneAssigned }: {
  on: boolean;
  onToggle: () => void;
  count: number;
  anyoneAssigned: boolean;
}) {
  const canOpenResources = useCanOpenPage()(ROUTES.resources);
  return (
    <>
      <ToggleButton
        on={on}
        onClick={onToggle}
        className="print:hidden"
        title="Mark tasks that book someone over 100% in a week (all projects)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        Overbooked people
        {on && count > 0 && (
          <span className={`ml-0.5 px-1.5 py-0.5 text-xs font-bold ${TOGGLE_BADGE_CLASS} rounded-full`}>{count}</span>
        )}
      </ToggleButton>
      {on && !anyoneAssigned && (
        <span className="text-xs text-gray-600 dark:text-gray-300 print:hidden">No one is assigned to tasks yet, so there&apos;s nothing to check.</span>
      )}
      {on && anyoneAssigned && canOpenResources && (
        <a
          href="/resources?tab=workload"
          className="text-xs font-medium text-amber-700 dark:text-amber-400 underline hover:text-amber-800 dark:hover:text-amber-300 print:hidden whitespace-nowrap"
          title="Everyone's weekly load, across all projects"
        >
          {count > 0 ? 'See Workload Heatmap' : 'No one over 100% · Workload Heatmap'}
        </a>
      )}
    </>
  );
}
