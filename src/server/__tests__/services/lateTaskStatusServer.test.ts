import { describe, it, expect, vi } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

import { ACTIVE_TASK_STATUSES, ACTIVE_STATUS_SQL, isActiveWork } from '../../constants/taskStatus';
import { evaluateRules, type ReviewInput, type ReviewTask } from '../../services/scheduleReview/rules';
import { digestRepository } from '../../database/DigestRepository';
import { databaseService } from '../../database/connection';

describe('"active work" = On Track or Late (one shared definition)', () => {
  it('lists the two statuses, as a helper and as SQL', () => {
    expect([...ACTIVE_TASK_STATUSES]).toEqual(['in_progress', 'late']);
    expect(ACTIVE_STATUS_SQL).toBe("('in_progress', 'late')");
    expect(isActiveWork('in_progress')).toBe(true);
    expect(isActiveWork('late')).toBe(true);
    for (const s of ['pending', 'completed', 'blocked', 'cancelled', 'in_review', undefined, null]) expect(isActiveWork(s)).toBe(false);
  });
});

const TODAY = new Date('2026-09-16T12:00:00Z');
function input(tasks: ReviewTask[]): ReviewInput {
  return {
    schedule: { id: 's1', startDate: '2026-07-06', endDate: '2027-07-06' }, project: { startDate: '2026-07-06', endDate: '2027-07-06' },
    tasks, resources: [], baselineCount: 1, latestBaselineTasks: null, floatByTask: null, overAllocations: null, today: TODAY,
  };
}
const t = (over: Partial<ReviewTask> & { id: string; name: string }): ReviewTask =>
  ({ status: 'pending', dependencies: [], sortOrder: 1, updatedAt: '2026-09-16T00:00:00Z', ...over }) as ReviewTask;

describe('Schedule Review treats a task marked Late as active work', () => {
  it('R08 flags a Late task that ended at 0%, naming its status in the screen words', () => {
    const { findings } = evaluateRules(input([t({ id: 'a', name: 'Slipped', status: 'late', progressPercentage: 0, startDate: '2026-08-25', endDate: '2026-09-15' })]));
    const r08 = findings.filter(f => f.ruleId === 'R08');
    expect(r08.map(f => f.taskIds[0])).toEqual(['a']);
    expect(r08[0].message ?? JSON.stringify(r08[0])).toContain('Late');
  });
  it('R24 flags a Late task nobody has touched for weeks', () => {
    const { findings } = evaluateRules(input([t({ id: 'b', name: 'Quiet', status: 'late', progressPercentage: 30, startDate: '2026-07-06', endDate: '2026-10-30', updatedAt: '2026-06-01T00:00:00Z' })]));
    expect(findings.filter(f => f.ruleId === 'R24').map(f => f.taskIds[0])).toEqual(['b']);
  });
});

describe('Digest sprint summary', () => {
  it('counts a Late task in the in-progress bucket, so the buckets add up', async () => {
    await digestRepository.findActiveSprintSummary(['p1']);
    const sql = String((databaseService.query as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]);
    expect(sql).toContain("t.status IN ('in_progress', 'late')");
  });
});
