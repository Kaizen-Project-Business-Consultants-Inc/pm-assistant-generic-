import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ config: { AI_ENABLED: false } }));

vi.mock('../../services/ProjectService', () => ({
  projectService: { findById: vi.fn().mockResolvedValue({ id: 'p1', projectType: 'it', methodology: 'waterfall' }) },
}));
vi.mock('../../services/SprintService', () => ({
  sprintService: { getByProject: vi.fn().mockResolvedValue([]) },
}));

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
  baselineService: {
    create: vi.fn().mockResolvedValue({ id: 'baseline-1' }),
    delete: vi.fn().mockResolvedValue(true),
    findById: vi.fn().mockResolvedValue({
      id: 'baseline-1',
      tasks: [
        { taskId: 'b', startDate: '2026-10-05', endDate: '2026-10-09' },
        { taskId: 'x', startDate: '2026-10-10', endDate: '2026-10-12' },
      ],
    }),
  },
}));

vi.mock('../../database/TaskRepository', () => ({
  taskRepository: { updateDates: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/ScheduleRecomputeService', () => ({
  scheduleRecomputeService: {
    recompute: vi.fn().mockResolvedValue({
      deltas: [{ taskId: 'b', name: 'Build', oldStart: '2026-10-05', oldEnd: '2026-10-09', newStart: '2026-10-10', newEnd: '2026-10-14', movedDays: 5 }],
      tasksMoved: 1, leafCount: 4, projectEndBefore: '2026-10-16', projectEndAfter: '2026-10-21', projectEndShiftDays: 5,
    }),
  },
}));

vi.mock('../../services/ScheduleReviewService', () => ({
  scheduleReviewService: {
    latest: vi.fn().mockResolvedValue({ id: 'rev-0', score: 19 }),
    run: vi.fn().mockResolvedValue({ id: 'rev-1', score: 63 }),
  },
  ScheduleReviewNotFoundError: class extends Error {},
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: vi.fn(() => false), completeWithJsonSchema: vi.fn() },
}));

const recordFeedback = vi.fn();
vi.mock('../../services/aiLearningService', () => ({
  AILearningServiceV2: class { recordFeedback = recordFeedback; },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue({}) },
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
  { id: 'g1', name: 'Gate 1', isMilestone: false, parentTaskId: undefined, startDate: '2026-10-19', endDate: '2026-10-25', estimatedDays: 4, dependencies: [] },
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
    expect(scheduleService.updateTask).toHaveBeenCalledWith('g1', { isMilestone: true, estimatedDays: 0, endDate: '2026-10-19' });
    expect(scheduleService.createTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'Phase 1', scheduleId: 's1' }));
    expect(scheduleService.updateTask).toHaveBeenCalledWith('x', { parentTaskId: 'phase-new' });
    expect(scheduleReviewService.run).toHaveBeenCalledWith('s1', 'post_proposal', 'u1', 'prop-1');

    const appliedLog = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(appliedLog.map(a => a.op)).toEqual(['remove_dependency', 'restore_milestone', 'delete_task', 'restore_parent']);
    expect(result).toMatchObject({ beforeScore: 19, afterScore: 63, appliedCount: 3, skipped: [], datesMoved: 1, projectEndShiftDays: 5, warning: null });

    const { auditLedgerService } = await import('../../services/AuditLedgerService');
    expect(auditLedgerService.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'schedule.fix.apply', entityId: 's1' }));
  });

  it('applies set_duration to match the date span and records a duration reversal', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    const prop = { ...PROPOSAL, proposalData: { fixes: [
      { id: 'dur1', type: 'set_duration', confidence: 0.7, reason: 'x', defaultChecked: true, taskId: 'b', newDuration: 14 },
    ] } };
    vi.mocked(repo.findById).mockResolvedValue({ ...prop } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'b', name: 'Build', isMilestone: false, parentTaskId: undefined, estimatedDays: 1, dependencies: [] },
    ] as any);

    const res = await (await svc()).apply('s1', 'prop-1', ['dur1'], 'u1');
    expect(scheduleService.updateTask).toHaveBeenCalledWith('b', { estimatedDays: 14 });
    const log = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(log.find((a: any) => a.op === 'restore_duration')).toMatchObject({ taskId: 'b', oldValue: 1 });
    expect(res.appliedCount).toBe(1);
  });

  it('applies insert_buffer: creates a buffer, rewires deps, and records a reversible log', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    const prop = { ...PROPOSAL, proposalData: { fixes: [
      { id: 'buf1', type: 'insert_buffer', confidence: 0.5, reason: 'x', defaultChecked: false, gateTaskId: 'g', gateName: 'Gate 1', bufferDays: 3 },
    ] } };
    vi.mocked(repo.findById).mockResolvedValue({ ...prop } as any);
    vi.mocked(scheduleService.createTask).mockResolvedValue({ id: 'buf-1' } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'g', name: 'Gate 1', isMilestone: true, parentTaskId: undefined, dependencies: [{ dependencyId: 'p', dependencyType: 'FS', lagDays: 0 }] },
    ] as any);

    const res = await (await svc()).apply('s1', 'prop-1', ['buf1'], 'u1');

    expect(scheduleService.createTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'Buffer before Gate 1', estimatedDays: 3, scheduleId: 's1' }));
    expect(scheduleService.addDependency).toHaveBeenCalledWith('buf-1', 'p', 'FS', 0); // buffer depends on old predecessor
    expect(scheduleService.removeDependency).toHaveBeenCalledWith('g', 'p');           // gate no longer depends on it directly
    expect(scheduleService.addDependency).toHaveBeenCalledWith('g', 'buf-1', 'FS', 0); // gate depends on buffer
    const log = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(log.map(a => a.op)).toEqual(['delete_task', 'readd_dependency', 'remove_dependency']);
    expect(res.appliedCount).toBe(1);
  });

  it('applies split_task: parts under the task, linked in order, links moved off the summary, reversible', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    const prop = { ...PROPOSAL, proposalData: { fixes: [
      { id: 'sp1', type: 'split_task', confidence: 0.7, reason: 'x', defaultChecked: true, taskId: 'brd', taskName: 'Circulate and obtain approval for BRD',
        parts: [{ name: 'Circulate BRD', isMilestone: false, days: 8 }, { name: 'BRD approved', isMilestone: true, days: 0 }] },
    ] } };
    vi.mocked(repo.findById).mockResolvedValue({ ...prop } as any);
    vi.mocked(scheduleService.createTask).mockResolvedValueOnce({ id: 'part-1' } as any).mockResolvedValueOnce({ id: 'part-2' } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'pre', name: 'Draft BRD', dependencies: [] },
      { id: 'brd', name: 'Circulate and obtain approval for BRD', startDate: '2026-10-01', endDate: '2026-10-10', assignedTo: 'Ann', status: 'pending', priority: 'high',
        dependencies: [{ dependencyId: 'pre', dependencyType: 'FS', lagDays: 0 }] },
      { id: 'des', name: 'Design', dependencies: [{ dependencyId: 'brd', dependencyType: 'FS', lagDays: 2 }] },
    ] as any);

    const res = await (await svc()).apply('s1', 'prop-1', ['sp1'], 'u1');

    expect(scheduleService.createTask).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Circulate BRD', parentTaskId: 'brd', afterTaskId: 'brd', startDate: '2026-10-01', endDate: '2026-10-10', isMilestone: false, assignedTo: 'Ann' }));
    expect(scheduleService.createTask).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'BRD approved', parentTaskId: 'brd', afterTaskId: 'part-1', startDate: '2026-10-10', endDate: '2026-10-10', isMilestone: true, estimatedDays: 0 }));
    expect(scheduleService.addDependency).toHaveBeenCalledWith('part-2', 'part-1', 'FF', 0);  // milestone lands the day the work finishes
    expect(scheduleService.addDependency).toHaveBeenCalledWith('part-1', 'pre', 'FS', 0);     // predecessor moved to the first part
    expect(scheduleService.removeDependency).toHaveBeenCalledWith('brd', 'pre');
    expect(scheduleService.addDependency).toHaveBeenCalledWith('des', 'part-2', 'FS', 2);     // successor now waits on the last part, lag kept
    expect(scheduleService.removeDependency).toHaveBeenCalledWith('des', 'brd');
    const log = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(log.map(a => a.op)).toEqual(['delete_task', 'delete_task', 'readd_dependency', 'readd_dependency', 'remove_dependency']);
    expect(res.appliedCount).toBe(1);
  });

  it('applies add_task: one task after its anchor, linked both ways, removed on undo', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    const prop = { ...PROPOSAL, proposalData: { fixes: [
      { id: 'ph1', type: 'add_task', confidence: 0.65, reason: 'x', defaultChecked: true, phaseLabel: 'Testing', newTaskName: 'System testing', newTaskDays: 5, afterTaskId: 'build', beforeTaskId: 'dep' },
    ] } };
    vi.mocked(repo.findById).mockResolvedValue({ ...prop } as any);
    vi.mocked(scheduleService.createTask).mockResolvedValue({ id: 'test-1' } as any);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'build', name: 'Build', startDate: '2026-10-01', endDate: '2026-10-10', parentTaskId: 'phase-b', dependencies: [] },
      { id: 'dep', name: 'Deploy', startDate: '2026-10-11', endDate: '2026-10-12', dependencies: [{ dependencyId: 'build', dependencyType: 'FS', lagDays: 0 }] },
    ] as any);

    await (await svc()).apply('s1', 'prop-1', ['ph1'], 'u1');

    expect(scheduleService.createTask).toHaveBeenCalledWith(expect.objectContaining({ name: 'System testing', afterTaskId: 'build', parentTaskId: 'phase-b', startDate: '2026-10-11', endDate: '2026-10-15', estimatedDays: 5 }));
    expect(scheduleService.addDependency).toHaveBeenCalledWith('test-1', 'build', 'FS', 0);
    expect(scheduleService.addDependency).toHaveBeenCalledWith('dep', 'test-1', 'FS', 0);
    const log = vi.mocked(repo.markApplied).mock.calls[0][1] as any[];
    expect(log.map(a => a.op)).toEqual(['delete_task']);
  });

  it('asks the AI once, with the splitting rule, only for what applies, and merges valid suggestions', async () => {
    const { config } = await import('../../config');
    const { claudeService } = await import('../../services/claudeService');
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    (config as any).AI_ENABLED = true;
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(scheduleReviewService.latest).mockResolvedValue({ id: 'rev-1', findings: [] } as any);
    vi.mocked(repo.insert).mockImplementation(async (r: any) => r);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'ph', name: 'Analysis', isSummary: true, dependencies: [] },
      { id: 'brd', name: 'Circulate and obtain approval for BRD', parentTaskId: 'ph', startDate: '2026-10-01', endDate: '2026-10-10', status: 'pending', dependencies: [] },
      { id: 'des', name: 'Solution design', parentTaskId: 'ph', startDate: '2026-10-11', endDate: '2026-10-20', status: 'pending', dependencies: [] },
      { id: 'bld', name: 'Build the API', parentTaskId: 'ph', startDate: '2026-10-21', endDate: '2026-10-30', status: 'pending', dependencies: [] },
      { id: 'go', name: 'Go-live', parentTaskId: 'ph', isMilestone: true, startDate: '2026-11-02', endDate: '2026-11-02', status: 'pending', dependencies: [] },
    ] as any);
    vi.mocked(claudeService.completeWithJsonSchema).mockResolvedValue({ data: {
      groups: [],
      splits: [{ taskId: 'brd', parts: [{ name: 'Circulate BRD', isMilestone: false, days: 8 }, { name: 'BRD approved', isMilestone: true, days: 0 }], reason: 'Approval is a separate decision' }],
      phases: [
        { phase: 'Testing', name: 'System and user acceptance testing', days: 10, afterTaskId: 'bld', beforeTaskId: 'go', reason: 'No testing planned' },
        { phase: 'Deployment', name: 'Deploy to production', days: 2, afterTaskId: null, beforeTaskId: null },
      ],
    } } as any);

    const proposal: any = await (await svc()).propose('s1', 'u1', true);

    expect(claudeService.completeWithJsonSchema).toHaveBeenCalledTimes(1);
    const call = vi.mocked(claudeService.completeWithJsonSchema).mock.calls[0][0] as any;
    expect(call.systemPrompt).toContain('SPLITTING RULE');
    expect(call.systemPrompt).toContain('Update and final review BRD');
    expect(call.systemPrompt).toContain('Testing, Deployment');  // the phases the review says are missing
    expect(call.systemPrompt).not.toContain('"groups": group');   // plan already has a phase: no grouping asked
    expect(call.userMessage).toContain('Circulate and obtain approval for BRD');
    expect(call.maxTokens).toBe(2500);
    const types = proposal.proposalData.fixes.map((f: any) => f.type);
    expect(types).toContain('split_task');
    expect(types.filter((t: string) => t === 'add_task')).toHaveLength(2);
    expect(proposal.source).toBe('ai');
    (config as any).AI_ENABLED = false;
    vi.mocked(claudeService.isAvailable).mockReturnValue(false);
  });

  it('makes no AI call when there is nothing for it to do', async () => {
    const { config } = await import('../../config');
    const { claudeService } = await import('../../services/claudeService');
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    const { projectService } = await import('../../services/ProjectService');
    const { scheduleFixProposalRepository: repo } = await import('../../database/ScheduleFixProposalRepository');
    (config as any).AI_ENABLED = true;
    vi.mocked(claudeService.isAvailable).mockReturnValue(true);
    vi.mocked(projectService.findById).mockResolvedValueOnce({ id: 'p1', projectType: 'other', methodology: 'waterfall' } as any);
    vi.mocked(scheduleReviewService.latest).mockResolvedValue({ id: 'rev-1', findings: [] } as any);
    vi.mocked(repo.insert).mockImplementation(async (r: any) => r);
    vi.mocked(scheduleService.findTasksByScheduleId).mockResolvedValue([
      { id: 'a', name: 'Design', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [] },
      { id: 'b', name: 'Build', startDate: '2026-10-03', endDate: '2026-10-04', dependencies: [] },
    ] as any);
    await (await svc()).propose('s1', 'u1', true);
    expect(claudeService.completeWithJsonSchema).not.toHaveBeenCalled();
    (config as any).AI_ENABLED = false;
    vi.mocked(claudeService.isAvailable).mockReturnValue(false);
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
      ...PROPOSAL, status: 'applied', baselineId: 'baseline-1',
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
    const { baselineService } = await import('../../services/BaselineService');
    const { taskRepository } = await import('../../database/TaskRepository');
    // dates restored from the baseline snapshot, then the baseline removed
    expect(taskRepository.updateDates).toHaveBeenCalledWith('b', '2026-10-05', '2026-10-09');
    expect(taskRepository.updateDates).toHaveBeenCalledWith('x', '2026-10-10', '2026-10-12');
    expect(baselineService.delete).toHaveBeenCalledWith('baseline-1');
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
