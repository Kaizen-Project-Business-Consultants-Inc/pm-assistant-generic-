import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ config: { AI_ENABLED: false } }));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn().mockResolvedValue({ id: 's1', projectId: 'p1', startDate: '2026-10-01', endDate: '2026-12-31' }),
    findTasksByScheduleId: vi.fn(),
    addDependency: vi.fn().mockResolvedValue(undefined),
    removeDependency: vi.fn().mockResolvedValue(true),
    updateTask: vi.fn().mockResolvedValue({ id: 't' }),
    createTask: vi.fn().mockResolvedValue({ id: 'phase-new' }),
    deleteTask: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../services/BaselineService', () => ({
  baselineService: { create: vi.fn().mockResolvedValue({ id: 'baseline-1' }) },
}));

vi.mock('../../services/ScheduleReviewService', () => ({
  scheduleReviewService: {
    latest: vi.fn().mockResolvedValue({ id: 'rev-0', score: 19 }),
    run: vi.fn().mockResolvedValue({ id: 'rev-1', score: 63 }),
  },
  ScheduleReviewNotFoundError: class extends Error {},
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: () => false, completeWithJsonSchema: vi.fn() },
}));

const recordFeedback = vi.fn();
vi.mock('../../services/aiLearningService', () => ({
  AILearningServiceV2: class { recordFeedback = recordFeedback; },
}));

vi.mock('../../database/ScheduleFixProposalRepository', () => ({
  scheduleFixProposalRepository: {
    findById: vi.fn(),
    findLatest: vi.fn(),
    insert: vi.fn(),
    supersedePending: vi.fn().mockResolvedValue(undefined),
    markApplied: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

const PROPOSAL = {
  id: 'prop-1', scheduleId: 's1', projectId: 'p1', status: 'pending', source: 'rules',
  reviewId: 'rev-0', rulesVersion: '1.0', createdBy: 'u1', createdAt: '', appliedAt: null,
  appliedData: null, baselineId: null,
  proposalData: {
    fixes: [
      { id: 'd1', type: 'add_dependency', confidence: 0.55, reason: 'seq', defaultChecked: false, taskId: 'b', dependsOnTaskId: 'a', dependencyType: 'FS', lagDays: 0 },
      { id: 'm1', type: 'set_milestone', confidence: 0.9, reason: 'ms', defaultChecked: true, taskId: 'g1' },
      { id: 'p1', type: 'set_parent', confidence: 0.5, reason: 'grp', defaultChecked: false, taskId: 'x', newParentName: 'Phase 1' },
    ],
  },
};

const TASKS = [
  { id: 'a', name: 'Design', isMilestone: false, parentTaskId: undefined, dependencies: [] },
  { id: 'b', name: 'Build', isMilestone: false, parentTaskId: undefined, dependencies: [] },
  { id: 'g1', name: 'Gate 1', isMilestone: false, parentTaskId: undefined, dependencies: [] },
  { id: 'x', name: 'T1 Task', isMilestone: false, parentTaskId: undefined, dependencies: [] },
];

describe('ScheduleFixProposerService', () => {
  beforeEach(() => vi.clearAllMocks());

  async function svc() {
    const mod = await import('../../services/ScheduleFixProposerService');
    return mod.scheduleFixProposerService;
  }

  it('applies selected fixes in order and records a reversal log', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { baselineService } = await import('../../services/BaselineService');
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    vi.mocked(repo.findById).mockResolvedValue({ ...PROPOSAL } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue(TASKS as any);

    const result = await (await svc()).apply('s1', 'prop-1', ['d1', 'm1', 'p1'], 'u1');

    expect(baselineService.create).toHaveBeenCalledWith('s1', 'Pre-review baseline', 'u1');
    expect(scheduleService.addDependency).toHaveBeenCalledWith('b', 'a', 'FS', 0);
    expect(scheduleService.updateTask).toHaveBeenCalledWith('g1', { isMilestone: true });
    expect(scheduleService.createTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'Phase 1', scheduleId: 's1' }));
    expect(scheduleService.updateTask).toHaveBeenCalledWith('x', { parentTaskId: 'phase-new' });
    expect(scheduleReviewService.run).toHaveBeenCalledWith('s1', 'post_proposal', 'u1', 'prop-1');

    const appliedLog = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(appliedLog.map(a => a.op)).toEqual(['remove_dependency', 'restore_milestone', 'delete_task', 'restore_parent']);
    expect(result).toEqual({ beforeScore: 19, afterScore: 63, appliedCount: 3, skipped: [] });
  });

  it('skips a dependency that is rejected (cycle) without failing the apply', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    vi.mocked(repo.findById).mockResolvedValue({ ...PROPOSAL } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue(TASKS as any);
    vi.mocked(scheduleService.addDependency).mockRejectedValueOnce(new Error('circular dependency'));

    const result = await (await svc()).apply('s1', 'prop-1', ['d1'], 'u1');
    expect(result.appliedCount).toBe(0);
    expect(result.skipped).toEqual([{ fixId: 'd1', reason: 'circular dependency' }]);
  });

  it('rejects apply when the proposal is not pending', async () => {
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    vi.mocked(repo.findById).mockResolvedValue({ ...PROPOSAL, status: 'applied' } as any);
    await expect((await svc()).apply('s1', 'prop-1', ['d1'], 'u1')).rejects.toThrow(/not pending/);
  });

  it('undoes an applied proposal by replaying the reversal log in reverse', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    vi.mocked(repo.findById).mockResolvedValue({
      ...PROPOSAL, status: 'applied',
      appliedData: [
        { op: 'remove_dependency', taskId: 'b', dependencyId: 'a' },
        { op: 'restore_milestone', taskId: 'g1', oldValue: false },
        { op: 'delete_task', taskId: 'phase-new' },
        { op: 'restore_parent', taskId: 'x', oldValue: null },
      ],
    } as any);

    const res = await (await svc()).undo('s1', 'prop-1', 'u1');

    const calls = vi.mocked(scheduleService).updateTask.mock.calls;
    // reverse order: restore_parent(x) first, then restore_milestone(g1)
    expect(scheduleService.updateTask).toHaveBeenCalledWith('x', { parentTaskId: null });
    expect(scheduleService.deleteTask).toHaveBeenCalledWith('phase-new');
    expect(scheduleService.updateTask).toHaveBeenCalledWith('g1', { isMilestone: false });
    expect(scheduleService.removeDependency).toHaveBeenCalledWith('b', 'a');
    expect(repo.setStatus).toHaveBeenCalledWith('prop-1', 'undone');
    expect(res.score).toBe(63);
    void calls;
  });

  it('reject records negative feedback and marks the proposal rejected', async () => {
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    vi.mocked(repo.findById).mockResolvedValue({ ...PROPOSAL } as any);

    await (await svc()).reject('s1', 'prop-1', 'not useful', 'u1');
    expect(recordFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'schedule_fix', userAction: 'rejected', feedbackText: 'not useful' }),
      'u1',
    );
    expect(repo.setStatus).toHaveBeenCalledWith('prop-1', 'rejected');
  });
});
