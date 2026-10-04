/** Weekly PM review — mirrors src/server/services/weeklyReview/picker.ts and WeeklyReviewService.ts */

export type WeeklyItemKind =
  | 'finish_at_risk' | 'task_late' | 'overloaded' | 'over_budget' | 'plan_quality'
  | 'risks_unhandled' | 'raid_overdue' | 'cr_waiting' | 'timesheets_waiting';

export type WeeklyItemArea = 'schedule' | 'resources' | 'budget' | 'raid' | 'changes' | 'time';

export interface WeeklyItem {
  key: string;
  kind: WeeklyItemKind;
  level: 'red' | 'amber';
  label: string;
  headline: string;
  suggestion: string;
  facts: string[];
  area: WeeklyItemArea;
  measure: number;
  refs?: { taskId?: string; scheduleId?: string; resourceId?: string };
}

export interface WeeklyFineNote { label: string; detail: string; level: 'green' | 'amber' }

export interface WeeklyResponse {
  itemKey: string;
  response: 'dismissed' | 'applied';
  reason: string | null;
  createdAt: string;
}

export interface WeeklyReview {
  id: string;
  projectId: string;
  projectName: string;
  weekStart: string;
  asOf: string;
  rag: 'red' | 'amber' | 'green';
  ragReason: string | null;
  items: WeeklyItem[];
  fine: WeeklyFineNote[];
  uncertainty: string[];
  moreFound: number;
  quietened: number;
  trigger: string;
  createdAt: string;
  responses: WeeklyResponse[];
}

/** One line of "This week's reviews" on the dashboard */
export interface MyWeeklyReview {
  projectId: string;
  projectName: string;
  reviewId: string;
  rag: 'red' | 'amber' | 'green';
  open: number;
  createdAt: string;
}

export type DismissReason = 'not_a_problem' | 'already_handled' | 'facts_wrong';

export const DISMISS_REASONS: Array<{ value: DismissReason; label: string }> = [
  { value: 'not_a_problem', label: 'Not a problem' },
  { value: 'already_handled', label: 'Already handled' },
  { value: 'facts_wrong', label: 'The facts are wrong' },
];

/** The project tab where each kind of problem is fixed */
export const AREA_TAB: Record<WeeklyItemArea, { tab: string; label: string }> = {
  schedule: { tab: 'schedule', label: 'Open the schedule' },
  resources: { tab: 'resources', label: 'Open resources' },
  budget: { tab: 'budget', label: 'Open the budget' },
  raid: { tab: 'raid', label: 'Open RAID' },
  changes: { tab: 'change-requests', label: 'Open change requests' },
  time: { tab: 'time', label: 'Open time' },
};

/** Decisions still open: on the list and not dismissed or applied */
export function openDecisions(review: WeeklyReview): WeeklyItem[] {
  const done = new Set(review.responses.map(r => r.itemKey));
  return review.items.filter(i => !done.has(i.key));
}

export const weeklyReviewKey = (projectId: string) => ['pm-weekly-review', projectId] as const;
