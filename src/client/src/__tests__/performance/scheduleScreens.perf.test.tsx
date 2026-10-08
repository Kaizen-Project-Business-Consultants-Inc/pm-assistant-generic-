import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { makePlan, measure, report, MAX_GROWTH_PER_DOUBLING, isWorkingYmd, type PerfPlan } from '../../../../server/__tests__/performance/perfData';
import { buildFlatRows, buildRowNumberMap, type GanttTask } from '../../components/schedule/gantt/types';
import { layoutTimelineStrip } from '../../components/schedule/gantt/timelineStrip';
import { useTaskFiltering } from '../../components/schedule/gantt/hooks/useTaskFiltering';
import { useTableGrouping } from '../../components/schedule/table/hooks/useTableGrouping';
import { packLanes, mondayOfYmd, shiftYmd } from '../../utils/plannerLayout';
import { findResourceConflicts, type WorkloadRow } from '../../utils/resourceConflicts';
import type { WorkCalendar } from '../../utils/workingDays';

/**
 * SPEED TEST — the schedule screens' in-browser work on a big plan, 2026-10-08. Same made-up plan
 * as the server speed tests (server/__tests__/performance/perfData.ts).
 *   - buildFlatRows / buildRowNumberMap (components/schedule/gantt/types.ts:126 / :118): the
 *     Gantt's outline rows and fixed row numbers, rebuilt on every task change
 *   - layoutTimelineStrip (components/schedule/gantt/timelineStrip.ts:60): the Timeline strip
 *   - useTaskFiltering (components/schedule/gantt/hooks/useTaskFiltering.ts:68): typing in the
 *     Gantt search box, then sorting by name (a parent stays when a child matches)
 *   - useTableGrouping (components/schedule/table/hooks/useTableGrouping.ts:31): Table sort by
 *     Duration (working days, counted on the calendar inside the sort) and group by person
 *   - packLanes (utils/plannerLayout.ts:34): Team Planner lanes for one busy person
 *   - findResourceConflicts (utils/resourceConflicts.ts:31): the Gantt's "Conflicts"
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                                   | N      | measured | limit  | growth per doubling |
 *   |----------------------------------------|--------|----------|--------|---------------------|
 *   | flat rows + row numbers                | 2,000  | 1.6 ms   | 50 ms  | 1.80–2.34 (< 3.0)   |
 *   | timeline strip layout                  | 2,000  | 6.0 ms   | 50 ms  | 1.49–2.17 (< 3.0)   |
 *   | Gantt search + sort by name            | 2,000  | 0.8 ms   | 50 ms  | 1.50–1.85 (< 3.0)   |
 *   | Table sort by Duration + group         | 1,000  | 241 ms   | 730 ms | 1.63–2.40 (< 3.0)   |
 *   | Team Planner lanes (1 person, all work)| 2,000  | 3.2 ms   | 50 ms  | 1.35–2.39 (< 3.0)   |
 *   | Gantt conflicts                        | 2,000  | 189 ms   | 570 ms | 2.08–2.36 (< 3.0)   |
 */

const LIMIT_MS = { flat: 50, strip: 50, search: 50, tableSort: 730, lanes: 50, conflicts: 570 };

const plans = new Map<number, { plan: PerfPlan; tasks: GanttTask[] }>();
function planOf(n: number) {
  if (!plans.has(n)) {
    const plan = makePlan(n);
    plans.set(n, { plan, tasks: plan.tasks as unknown as GanttTask[] });
  }
  return plans.get(n)!;
}

// The project calendar as the server sends it: every non-working date (weekends + holidays) in range
const calendar: WorkCalendar = (() => {
  const nonWorking = new Set<string>();
  for (let t = Date.parse('2026-01-01T00:00:00Z'); t <= Date.parse('2028-12-31T00:00:00Z'); t += 86_400_000) {
    const ymd = new Date(t).toISOString().slice(0, 10);
    if (!isWorkingYmd(ymd)) nonWorking.add(ymd);
  }
  return { nonWorking, from: '2026-01-01', to: '2028-12-31' };
})();

// ---- the cases: each returns a function that does the work once ----

const flatRows = (n: number) => { const { tasks } = planOf(n); return () => { buildFlatRows(tasks, new Set()); buildRowNumberMap(tasks); }; };

const strip = (n: number) => { const { tasks } = planOf(n); return () => layoutTimelineStrip(tasks as never, 'Programme'); };

// hooks rendered by a case, unmounted after each test so they don't pile up on the heap
const mounted: Array<() => void> = [];

function ganttSearchSort(n: number) {
  const { tasks } = planOf(n);
  const collapsed = new Set<string>();
  const { result, unmount } = renderHook(() => useTaskFiltering({ tasks, collapsedIds: collapsed }));
  mounted.push(unmount);
  let flip = false;
  return () => {
    flip = !flip;
    act(() => result.current.setSearchQuery(flip ? 'payments' : 'deploy'));
    act(() => { result.current.setSortField('name'); result.current.setSortDirection(flip ? 'asc' : 'desc'); });
    return result.current.rows.length;
  };
}

function tableSortGroup(n: number) {
  const { tasks } = planOf(n);
  const empty = new Map();
  const { result, unmount } = renderHook(() => useTableGrouping({ tasks, cpmMap: empty, baselineMap: empty, workCalendar: calendar }));
  mounted.push(unmount);
  let flip = false;
  return () => {
    flip = !flip;
    act(() => { result.current.setSortField('duration' as never); result.current.setSortDir(flip ? 'asc' : 'desc'); result.current.setGroupBy(flip ? 'assignedTo' : 'status'); });
    return result.current.groupedSorted?.size;
  };
}

const weeks = (() => { const out: string[] = []; let w = mondayOfYmd('2026-01-05'); for (let i = 0; i < 110; i++) { out.push(w); w = shiftYmd(w, 7); } return out; })();
function plannerLanes(n: number) {
  const { plan } = planOf(n);
  // one person holding a sixtieth of everything, over the whole programme (the busiest row)
  const blocks = plan.bookings.filter((_, i) => i % 6 === 0).map(b => ({ startDate: b.startDate, endDate: b.endDate }));
  return () => packLanes(blocks, weeks);
}

function conflicts(n: number) {
  const { plan, tasks } = planOf(n);
  const workload: WorkloadRow[] = plan.resources.map((r, i) => ({
    resourceId: r.id, resourceName: r.name,
    weeks: weeks.map((w, k) => ({ weekStart: w, utilization: (i + k) % 4 === 0 ? 130 : 80 })),
  }));
  const headings = new Set(tasks.filter(t => t.isSummary).map(t => t.id));
  return () => findResourceConflicts(tasks as never, workload, headings);
}

// [label, case, N, limit at N (ms)] — growth is measured from N/4 to N
const CASES: Array<[string, (n: number) => () => unknown, number, number]> = [
  ['flat rows + row numbers', flatRows, 2000, LIMIT_MS.flat],
  ['timeline strip', strip, 2000, LIMIT_MS.strip],
  ['gantt search + sort', ganttSearchSort, 2000, LIMIT_MS.search],
  // Slow but linear (not O(n²)) — see efficiency report: the Duration sort counts each task's
  // working days inside the sort comparison (day by day, twice per comparison), so one click
  // re-walks the calendar ~n·log n times. Hence N = 1,000 here; the budget is at current behaviour.
  ['table sort duration + group', tableSortGroup, 1000, LIMIT_MS.tableSort],
  ['planner lanes', plannerLanes, 2000, LIMIT_MS.lanes],
  ['gantt conflicts', conflicts, 2000, LIMIT_MS.conflicts],
];

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: schedule screens (client)', { retry: 1 }, () => {
  beforeAll(() => { planOf(250); planOf(500); planOf(1000); planOf(2000); });
  afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); });

  it('sanity: the cases do real work', () => {
    expect(buildFlatRows(planOf(2000).tasks, new Set())).toHaveLength(2000);
    expect(layoutTimelineStrip(planOf(2000).tasks as never)?.phases.length).toBeGreaterThan(4);
    expect(ganttSearchSort(2000)()).toBeGreaterThan(20);
    expect(tableSortGroup(1000)()).toBeGreaterThan(10);
    expect((plannerLanes(2000)() as { lanes: number }).lanes).toBeGreaterThan(3);
    expect((conflicts(2000)() as Map<string, string[]>).size).toBeGreaterThan(40);
  });

  it.each(CASES)('%s: within budget, and 2× the plan is about 2× the time', async (label, make, n, limit) => {
    const m = await measure(make, n);
    report(`client ${label} N=${n}`, m);
    expect(m.fastest).toBeLessThan(limit);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
