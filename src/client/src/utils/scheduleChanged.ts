import type { QueryClient } from '@tanstack/react-query';

/** Everything cached per plan that is worked out from its tasks, dates and links: ['<key>', scheduleId, …] */
export const SCHEDULE_DERIVED_KEYS = [
  'tasks', // Gantt, Table, Kanban, Calendar, the Overview card and the setup (readiness) bar
  'criticalPath', // the critical path card, view and Gantt highlight
  'network-diagram',
  'burndown',
  'histogram',
  'schedule-review',
  'schedule-changes', // History
  'baselineComparison',
  'scenarios',
  'scenarioCompare',
  'autoRescheduleDelays',
  'actual-vs-estimated',
  'backlog',
  'epics',
  'epic-children',
] as const;

/**
 * Cached per project and worked out from its plans: ['<key>', projectId, …]. Not the AI forecast
 * (['evmForecastAI']): fetching it again costs an AI call.
 */
export const PROJECT_DERIVED_KEYS = [
  'project-summary',
  'schedules',
  'evm',
  'evm-variances',
  'sCurve',
  'workload',
  'resource-usage',
  'resource-forecast',
  'health-history',
  'taskSlips',
  'time-burndown',
] as const;

/**
 * The project page summary is heavy (every task of the first plan) and only seeds caches the page
 * then reads, so it is never fetched again here: dropped when off screen, marked out of date
 * when on screen. The page seeds a key only when the summary is newer (ProjectDetailPage), so an
 * old summary can't put an old plan back.
 */
const NO_REFETCH = new Set<string>(['project-summary']);

/**
 * Fill a cache key from data fetched at `updatedAt` (the project page summary) — only when the key
 * is empty or older. A cached summary must never put back an older plan over a newer edit.
 */
export function seedIfOlder(queryClient: QueryClient, queryKey: unknown[], value: unknown, updatedAt: number): void {
  if ((queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0) >= updatedAt) return;
  queryClient.setQueryData(queryKey, value, { updatedAt });
}

function refresh(queryClient: QueryClient, keys: unknown[][]): void {
  for (const queryKey of keys) {
    queryClient.removeQueries({ queryKey, type: 'inactive' });
    void queryClient.invalidateQueries({ queryKey, refetchType: NO_REFETCH.has(queryKey[0] as string) ? 'none' : 'active' });
  }
}

const projectKeys = (projectId: string | undefined): unknown[][] =>
  PROJECT_DERIVED_KEYS.map(k => (projectId ? [k, projectId] : [k]));

/**
 * After a change to the whole plan — Propose fixes Apply/Undo, a History undo, an import,
 * Auto-reschedule, resource levelling, bulk links, grouping, bulk delete, promoting a scenario,
 * a Team Planner move, meeting changes, Mjuzi link changes — every view of that plan fetches
 * again: the ones on screen now, the others (dropped) when they are opened. Marking them stale is
 * not enough: the app never refetches on mount (queryClient.ts), so the critical path kept saying
 * "link your tasks first" after Propose fixes added links (U38). Scoped to the plan and its
 * project (CLAUDE.md lesson 5). projectId is undefined only where the caller can't know it: the
 * project-wide figures then refresh on their own schedule.
 */
export function refreshAfterScheduleChange(
  queryClient: QueryClient,
  { scheduleId, projectId }: { scheduleId: string; projectId: string | undefined },
): void {
  const keys: unknown[][] = SCHEDULE_DERIVED_KEYS.map(k => [k, scheduleId]);
  if (projectId) keys.push(...projectKeys(projectId));
  refresh(queryClient, keys);
}

/**
 * After a change that moves tasks in many plans: a project's working calendar (all its plans;
 * projectId given) or a company holiday (every project; projectId undefined). Only the views on
 * screen fetch now; the rest are dropped, since the app never refetches on mount.
 */
export function refreshAfterPlansChange(queryClient: QueryClient, { projectId }: { projectId: string | undefined }): void {
  const cached = projectId
    ? queryClient.getQueryData<{ schedules?: Array<{ id: string }> }>(['schedules', projectId])?.schedules
    : undefined;
  const scheduleKeys: unknown[][] = cached
    ? cached.flatMap(s => SCHEDULE_DERIVED_KEYS.map(k => [k, s.id]))
    : SCHEDULE_DERIVED_KEYS.map(k => [k]);
  refresh(queryClient, [...scheduleKeys, ...projectKeys(projectId)]);
}

/** The project a plan belongs to, from the cached plan lists (['schedules', projectId]) */
export function projectOfSchedule(queryClient: QueryClient, scheduleId: string): string | undefined {
  for (const [key, data] of queryClient.getQueriesData<{ schedules?: Array<{ id: string }> }>({ queryKey: ['schedules'] })) {
    if (typeof key[1] === 'string' && data?.schedules?.some(s => s.id === scheduleId)) return key[1];
  }
  return undefined;
}
