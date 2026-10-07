/**
 * % complete from approved hours, for a task being reopened (code health step 1F, 2026-10-06).
 *
 * ScheduleService needs this answer inside the same save (a reopened task goes back to what its
 * approved hours say — see ScheduleService.updateTask). The answer comes from
 * ApprovedTimeService, which itself imports ScheduleService and ResourceService, so asking it
 * directly closed an import circle. Instead ApprovedTimeService's `progressFor` is handed in here
 * once at startup (domainListeners.ts, run by the app and the scheduled-jobs runner) and
 * ScheduleService asks through this file. This file imports nothing from the app, so it can
 * never close a circle (see importCycleGuard.test.ts).
 *
 * This is a question with an answer, not a notice: the caller waits for the result, in its own
 * request context, exactly as it waited for the direct call before.
 */
export type ApprovedProgressFor = (taskId: string) => Promise<number | null>;

let provider: ApprovedProgressFor | null = null;

export function registerApprovedProgress(fn: ApprovedProgressFor): void {
  provider = fn;
}

/** The provider handed in at startup, or null if this process never connected it */
export function approvedProgressProvider(): ApprovedProgressFor | null {
  return provider;
}

/** Test hook */
export function _resetApprovedProgressForTests(): void { provider = null; }
