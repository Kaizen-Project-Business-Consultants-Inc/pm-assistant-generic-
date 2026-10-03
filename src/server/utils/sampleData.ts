/**
 * The read-only sample project (tenant migration T033, `projects.is_demo = 1`) and every row seeded
 * with it — its example people in `resources` included — have ids starting `demo-`.
 *
 * While the sample is loaded it never counts: portfolio and dashboard totals, budgets and earned
 * value, capacity and workload, the Team Planner, the briefing, alerts and reports all leave it out.
 * Projects use `COALESCE(p.is_demo, 0) = 0` (SQL) or `!p.isDemo` (JS); people use isExamplePerson.
 * The guard test `sampleOutOfTotalsGuard.test.ts` pins every place that does this.
 */
export const SAMPLE_ID_PREFIX = 'demo-';

/** An example person seeded with the sample project — not a real member of the company. */
export function isExamplePerson(resource: { id: string }): boolean {
  return String(resource.id).startsWith(SAMPLE_ID_PREFIX);
}
