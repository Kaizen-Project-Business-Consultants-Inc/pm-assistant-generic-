import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { findResourceConflicts, type ConflictTask, type WorkloadRow } from '../utils/resourceConflicts';

const NONE = new Map<string, string[]>();

/**
 * "Overbooked people" for a schedule view (Gantt, Table, Kanban — U65): taskId → one line per
 * person over 100% in a week the task touches, from the Workload Heatmap's own numbers (every
 * project). Fetched only while the toggle is on. `anyoneAssigned` false = no task has a person,
 * so an empty result means "nothing to check", not "all clear".
 */
export function useResourceConflicts(tasks: Array<ConflictTask & { parentTaskId?: string | null }>, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['workload', '__all__'],
    queryFn: () => apiService.getGlobalResourceWorkload(),
    enabled,
    staleTime: 60_000,
  });
  const headingIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) if (t.parentTaskId) set.add(t.parentTaskId);
    return set;
  }, [tasks]);
  const notes = useMemo(
    () => (enabled ? findResourceConflicts(tasks, (data?.workload ?? []) as WorkloadRow[], headingIds) : NONE),
    [enabled, tasks, data, headingIds],
  );
  const anyoneAssigned = useMemo(() => tasks.some(t => !!t.assignedTo || (t.assignments?.length ?? 0) > 0), [tasks]);
  return { notes, anyoneAssigned };
}
