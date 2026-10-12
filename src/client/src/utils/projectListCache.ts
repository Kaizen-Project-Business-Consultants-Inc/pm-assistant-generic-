import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cached list that shows projects — the dashboard, the Projects page, the sidebar
 * favourites, clients, portfolio and the page pickers — plus the dashboard numbers built from them.
 */
export const PROJECT_LIST_KEYS = [
  ['projects'],
  ['pm-projects'],
  ['pm-all-projects'],
  ['favourite-projects'],
  ['portfolio'],
  ['dashboard-predictions'],
  ['analytics-summary'],
] as const;

/**
 * After a project is created, renamed, archived, unarchived, deleted or changes status: the lists
 * on screen fetch again, and the ones on other pages are dropped so they load fresh when opened.
 * Marking them stale is not enough — the app never refetches on mount (main.tsx), so an archived
 * project stayed on the dashboard and an unarchived one never came back (2026-10-11).
 */
export function refreshProjectLists(queryClient: QueryClient): void {
  for (const queryKey of PROJECT_LIST_KEYS) {
    queryClient.removeQueries({ queryKey, type: 'inactive' });
    void queryClient.invalidateQueries({ queryKey });
  }
}
