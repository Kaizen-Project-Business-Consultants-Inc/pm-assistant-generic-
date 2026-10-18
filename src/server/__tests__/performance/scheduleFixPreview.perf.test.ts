import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, clonePlanTasks, type PerfTask } from './perfData';

/**
 * SPEED TEST — Propose fixes' preview ("If you apply what is ticked"), 2026-10-18.
 * ScheduleFixProposerService.preview: 200 ticked links applied to an in-memory copy
 * (scheduleReview/fixPreview.ts), the shared forward pass (planReflow), summaries rolled up, and
 * the review rules on the result. What the review reads besides the tasks (float, resources,
 * baselines, the score now) is read once per proposal and reused, so this times one tick of the
 * panel: the tasks are read (mocked here) and everything else is the algorithm.
 *
 * Limit = 3× the median measured on the dev machine (2026-10-18), rounded up to 10 ms; growth
 * per doubling from N/4 to N fails at 3.0 (linear ≈ 2, O(n²) ≈ 4).
 *
 *   | case                          | N      | measured | limit   | growth per doubling |
 *   |-------------------------------|--------|----------|---------|---------------------|
 *   | preview, 200 links ticked     | 5,000  | 1,390 ms | 4300 ms | 2.04–2.28 (< 3.0)   |
 *
 * About 70% of it is the review rules themselves (reviewSchedule, the same as a review run); the
 * copy and the re-flow are the rest. The panel asks at most once per 800 ms of ticking.
 */

const N = 5000;
const LIMIT_MS = 4300;

let current: PerfTask[] = [];
const proposals = new Map<string, any>();
vi.mock('../../utils/logger', () => ({ default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
vi.mock('../../config', () => ({ config: { AI_ENABLED: false } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findTasksByScheduleId: async () => clonePlanTasks(current) } }));
vi.mock('../../database/ScheduleFixProposalRepository', () => ({ scheduleFixProposalRepository: { findById: async (id: string) => proposals.get(id) } }));
vi.mock('../../services/claudeService', () => ({ claudeService: { isAvailable: () => false } }));
vi.mock('../../services/aiLearningService', () => ({ AILearningServiceV2: class { recordFeedback = () => {}; } }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ userId: 'u-1', tenantDbName: 't1' }), getActorSource: () => 'web' }));
vi.mock('../../services/ScheduleReviewService', async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    scheduleReviewService: {
      gatherInput: async () => {
        const tasks = clonePlanTasks(current);
        const leaves = tasks.filter(t => !t.isSummary);
        return {
          tasks, projectId: 'p1',
          input: {
            schedule: { id: 's1', startDate: '2026-01-05', endDate: '2027-12-31' },
            project: { startDate: '2026-01-05', endDate: '2027-12-31', projectType: 'it', methodology: 'waterfall' },
            sprintCount: 0, sprints: [], tasks: tasks.map(real.toReviewTask), resources: [],
            baselineCount: 1, latestBaselineTasks: leaves.map(t => ({ taskId: t.id, startDate: t.startDate, endDate: t.endDate })),
            floatByTask: new Map(leaves.map((t, i) => [t.id, (i % 60) - 5])), overAllocations: [],
            today: new Date('2026-10-08T12:00:00Z'), isWorking,
          },
        };
      },
    },
  };
});

import { scheduleFixProposerService } from '../../services/ScheduleFixProposerService';

const plans = new Map<number, { tasks: PerfTask[]; ids: string[] }>();
/** A plan of n tasks and a proposal of 200 links between neighbouring working tasks */
function planOf(n: number) {
  if (plans.has(n)) return plans.get(n)!;
  const tasks = makePlan(n).tasks;
  const leaves = tasks.filter(t => !t.isSummary);
  const step = Math.max(1, Math.floor(leaves.length / 201));
  const fixes = Array.from({ length: 200 }, (_, i) => {
    const prev = leaves[i * step];
    const next = leaves[i * step + 1];
    return { id: `l${i}`, type: 'add_dependency', confidence: 0.5, reason: '', defaultChecked: false, taskId: next.id, dependsOnTaskId: prev.id, dependencyType: 'FS', lagDays: 0, overlaps: true };
  });
  proposals.set(`prop-${n}`, { id: `prop-${n}`, scheduleId: 's1', projectId: 'p1', status: 'pending', proposalData: { fixes } });
  plans.set(n, { tasks, ids: fixes.map(f => f.id) });
  return plans.get(n)!;
}
const run = (n: number) => () => {
  const p = planOf(n);
  current = p.tasks;
  return scheduleFixProposerService.preview('s1', `prop-${n}`, p.ids);
};

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: Propose fixes preview', { retry: 1 }, () => {
  beforeAll(() => { planOf(N / 4); planOf(N); });

  it(`${N.toLocaleString('en')} tasks, 200 links ticked, within budget, and 2× the plan is about 2× the time`, async () => {
    const res = await run(N)();
    expect(res.tasksMoved).toBeGreaterThan(0);
    const m = await measure(run, N, 3);
    report(`fix preview N=${N}`, { ...m, moved: res.tasksMoved });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  }, 120_000);
});
