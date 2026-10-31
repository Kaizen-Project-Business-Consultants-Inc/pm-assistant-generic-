/** A task the PM accepted as longer than one reporting period ("Cannot be split") — mirrors the server's TaskSplitException */
export interface SplitException {
  taskId: string;
  taskName: string;
  reason: string;
  createdByName: string;
  createdAt: string;
}

/** The rule's Schedule Review id (src/server/services/scheduleReview/rules.ts R42) */
export const PERIOD_RULE_ID = 'R42';

export const splitExceptionsKey = (scheduleId: string) => ['schedule-review', scheduleId, 'exceptions'] as const;
