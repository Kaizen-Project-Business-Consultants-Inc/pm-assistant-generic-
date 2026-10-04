import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  project: vi.fn(),
  schedules: vi.fn(),
  tasks: vi.fn(),
  delays: vi.fn(),
  workload: vi.fn(),
  evm: vi.fn(),
  reviewLatest: vi.fn(),
  reviewHistory: vi.fn(),
  pending: vi.fn(),
  risks: vi.fn(),
  crs: vi.fn(),
  insert: vi.fn(),
  findById: vi.fn(),
  dismissals: vi.fn(),
  saveResponse: vi.fn(),
  responsesFor: vi.fn(),
}));

vi.mock('../../services/ProjectService', () => ({ projectService: { findById: m.project } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findByProjectId: m.schedules, findTasksByScheduleIds: m.tasks } }));
vi.mock('../../services/AutoRescheduleService', () => ({ autoRescheduleService: { detectDelays: m.delays } }));
vi.mock('../../services/ResourceService', () => ({ resourceService: { computeWorkload: m.workload } }));
vi.mock('../../services/EVMForecastService', () => ({ evmForecastService: { generateMetricsOnly: m.evm } }));
vi.mock('../../services/ScheduleReviewService', () => ({ scheduleReviewService: { latest: m.reviewLatest, history: m.reviewHistory } }));
vi.mock('../../services/WeeklyTimesheetService', () => ({ weeklyTimesheetService: { projectPending: m.pending } }));
vi.mock('../../services/StatusDateService', () => ({ statusDateFor: async () => '2026-10-09' }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: { findByProject: m.risks } }));
vi.mock('../../database/ApprovalWorkflowRepository', () => ({ approvalWorkflowRepository: { findChangeRequests: m.crs } }));
vi.mock('../../database/WeeklyReviewRepository', () => ({
  weeklyReviewRepository: {
    insert: m.insert, findById: m.findById, prune: async () => {}, dismissalsSince: m.dismissals,
    saveResponse: m.saveResponse, responsesFor: m.responsesFor, findLatest: vi.fn(),
  },
}));

import { weeklyReviewService, WeeklyReviewNotFoundError } from '../../services/WeeklyReviewService';

const risk = (over: Record<string, unknown>) => ({
  id: 'x', type: 'risk', title: 'R', severity: 'high', status: 'open', ownerId: 'u1', ownerResourceId: null,
  responseStrategy: 'mitigate', mitigationPlan: null, responsePlan: null, dueDate: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.project.mockResolvedValue({ id: 'p1', name: 'DBJ-Loans', budgetAllocated: 100_000, currency: 'USD' });
  m.schedules.mockResolvedValue([{ id: 's1', name: 'Main plan' }, { id: 's2', name: 'What-if', isScenario: true }]);
  m.tasks.mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 'sum', isSummary: true }]);
  m.delays.mockResolvedValue([{ taskId: 't1', taskName: 'UAT scripts', delayDays: 5, isOnCriticalPath: true, currentProgress: 40 }]);
  m.workload.mockResolvedValue([
    { resourceId: 'r1', resourceName: 'Peter', weeks: [
      { weekStart: '2026-09-28', allocated: 60, capacity: 40, thisProject: 10 }, // before this week: ignored
      { weekStart: '2026-10-05', allocated: 48, capacity: 40, thisProject: 20 },
      { weekStart: '2026-10-12', allocated: 50, capacity: 40, thisProject: 0 }, // not on this project that week: ignored
      { weekStart: '2026-10-19', allocated: 70, capacity: 40, thisProject: 20 }, // beyond two weeks: ignored
    ] },
    { resourceId: 'r2', resourceName: 'Parth', weeks: [{ weekStart: '2026-10-05', allocated: 20, capacity: 40, thisProject: 20 }] },
  ]);
  m.evm.mockResolvedValue({ currentMetrics: { BAC: 100_000, EV: 40_000, AC: 39_000, PV: 40_000, CPI: 1.03, SPI: 1, EAC: 97_000, ETC: 0, VAC: 3_000, TCPI: 1 } });
  m.reviewLatest.mockResolvedValue({ score: 86, leafTaskCount: 2, counts: { critical: 0 }, createdAt: '2026-10-09T04:00:00Z', findings: [{ ruleId: 'R24', taskIds: ['t2'] }] });
  m.reviewHistory.mockResolvedValue([
    { score: 86, createdAt: '2026-10-09T04:00:00Z' },
    { score: 84, createdAt: '2026-10-06T04:00:00Z' },
    { score: 82, createdAt: '2026-10-02T04:00:00Z' },
  ]);
  m.pending.mockResolvedValue([]);
  m.risks.mockResolvedValue([
    risk({ id: 'a', title: 'Vendor late', ownerId: null }),
    risk({ id: 'b', title: 'No plan', responseStrategy: null }),
    risk({ id: 'c', title: 'Handled' }),
    risk({ id: 'd', title: 'Closed one', status: 'closed', ownerId: null }),
    risk({ id: 'e', title: 'Low one', severity: 'low', ownerId: null }),
    risk({ id: 'f', type: 'action', title: 'Overdue action', severity: 'low', dueDate: '2026-10-01' }),
  ]);
  m.crs.mockResolvedValue([
    { id: 'c1', title: 'Add SSO', status: 'pending', createdAt: '2026-09-29 10:00:00' },
    { id: 'c2', title: 'Old', status: 'approved', createdAt: '2026-08-01 10:00:00' },
  ]);
  m.dismissals.mockResolvedValue([]);
});

describe('WeeklyReviewService.gatherFacts', () => {
  it('turns the project data into the week\'s facts', async () => {
    const { facts, projectName } = await weeklyReviewService.gatherFacts('p1');
    expect(projectName).toBe('DBJ-Loans');
    expect(m.delays).toHaveBeenCalledTimes(1); // the what-if scenario is not reviewed
    expect(facts.taskCount).toBe(2);
    expect(facts.delays[0]).toMatchObject({ taskId: 't1', scheduleId: 's1', delayDays: 5 });
    expect(facts.overloads).toEqual([{ resourceId: 'r1', resourceName: 'Peter', weeks: [{ weekStart: '2026-10-05', allocated: 48, capacity: 40 }] }]);
    expect(facts.evm).toMatchObject({ CPI: 1.03, BAC: 100_000 });
    expect(facts.plans).toEqual([{ scheduleId: 's1', name: 'Main plan', score: 86, previousScore: 82, critical: 0, staleTasks: 1 }]);
    expect(facts.raid.open).toBe(5);
    expect(facts.raid.unhandled).toEqual([
      { id: 'a', title: 'Vendor late', why: 'no owner' },
      { id: 'b', title: 'No plan', why: 'no response chosen' },
    ]);
    expect(facts.raid.overdue).toEqual([{ id: 'f', title: 'Overdue action', dueDate: '2026-10-01' }]);
    expect(facts.changeRequests).toEqual([{ id: 'c1', title: 'Add SSO', waitingDays: 10 }]);
  });

  it('a part that fails is left out, not the whole review', async () => {
    m.workload.mockRejectedValue(new Error('boom'));
    m.evm.mockRejectedValue(new Error('no schedule'));
    const { facts } = await weeklyReviewService.gatherFacts('p1');
    expect(facts.overloads).toEqual([]);
    expect(facts.evm).toBeNull();
    expect(facts.delays).toHaveLength(1);
  });

  it('no budget, or nothing earned or spent yet: cost is not judged', async () => {
    m.project.mockResolvedValue({ id: 'p1', name: 'X', budgetAllocated: 0, currency: 'USD' });
    expect((await weeklyReviewService.gatherFacts('p1')).facts.evm).toBeNull();
    expect(m.evm).not.toHaveBeenCalled();
    m.project.mockResolvedValue({ id: 'p1', name: 'X', budgetAllocated: 5000, currency: 'USD' });
    m.evm.mockResolvedValue({ currentMetrics: { BAC: 5000, EV: 0, AC: 0, PV: 0, CPI: 0, SPI: 0, EAC: 0, ETC: 0, VAC: 0, TCPI: 0 } });
    expect((await weeklyReviewService.gatherFacts('p1')).facts.evm).toBeNull();
  });

  it('unknown project: not found', async () => {
    m.project.mockResolvedValue(null);
    await expect(weeklyReviewService.gatherFacts('nope')).rejects.toBeInstanceOf(WeeklyReviewNotFoundError);
  });
});

describe('WeeklyReviewService.run and dismiss', () => {
  it('stores the pick with the week it belongs to', async () => {
    m.findById.mockImplementation(async (id: string) => ({ ...m.insert.mock.calls[0][0], id, createdAt: '2026-10-09T05:00:00Z' }));
    const review = await weeklyReviewService.run('p1', 'manual', 'u1');
    const row = m.insert.mock.calls[0][0];
    expect(row).toMatchObject({ projectId: 'p1', weekStart: '2026-10-05', asOf: '2026-10-09', rag: 'red', trigger: 'manual', createdBy: 'u1' });
    expect(row.items.map((i: any) => i.kind)).toEqual(['finish_at_risk', 'overloaded', 'risks_unhandled', 'raid_overdue', 'cr_waiting']);
    expect(review.projectName).toBe('DBJ-Loans');
    expect(m.dismissals).toHaveBeenCalledWith('p1', '2026-09-11');
  });

  it('dismiss records the reason and the size of the problem', async () => {
    m.findById.mockResolvedValue({ id: 'rv1', projectId: 'p1', items: [{ key: 'delay:t1', measure: 5 }] });
    m.responsesFor.mockResolvedValue([{ itemKey: 'delay:t1', response: 'dismissed', reason: 'already_handled' }]);
    const out = await weeklyReviewService.dismiss('p1', 'rv1', 'delay:t1', 'already_handled', 'u1');
    expect(m.saveResponse).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'rv1', itemKey: 'delay:t1', response: 'dismissed', reason: 'already_handled', measure: 5 }));
    expect(out).toHaveLength(1);
  });

  it('dismiss refuses another project\'s review or an unknown item', async () => {
    m.findById.mockResolvedValue({ id: 'rv1', projectId: 'other', items: [{ key: 'delay:t1', measure: 5 }] });
    await expect(weeklyReviewService.dismiss('p1', 'rv1', 'delay:t1', 'not_a_problem', 'u1')).rejects.toBeInstanceOf(WeeklyReviewNotFoundError);
    m.findById.mockResolvedValue({ id: 'rv1', projectId: 'p1', items: [] });
    await expect(weeklyReviewService.dismiss('p1', 'rv1', 'delay:t1', 'not_a_problem', 'u1')).rejects.toBeInstanceOf(WeeklyReviewNotFoundError);
    expect(m.saveResponse).not.toHaveBeenCalled();
  });
});
