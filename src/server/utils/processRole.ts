/**
 * Whether this process is the scheduled-job runner (scripts/runCronJob.ts) rather than the app
 * server. Some steps only work in the app server — agent capabilities are registered there, not in a
 * job — so a workflow run by a job skips them instead of failing every run (2026-10-12).
 */
let jobRunner = false;

export function markAsJobRunner(): void {
  jobRunner = true;
}

export function isJobRunner(): boolean {
  return jobRunner;
}
