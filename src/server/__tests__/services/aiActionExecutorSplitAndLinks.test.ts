import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mjuzi's plan edits (M1 + M7, 2026-10-23): splitting a task keeps the original as the first part with the others right after it,
 * links never point at a phase row, a link that points down the plan is flagged, and list_tasks
 * speaks in the row numbers the schedule screen shows.
 */
vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTaskById: vi.fn(),
    findTasksByScheduleId: vi.fn(),
    findById: vi.fn(async () => ({ id: 's1', projectId: 'p1', name: 'Plan' })),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(async () => true),
    validateDependency: vi.fn(async () => {}),
  },
  DependencyValidationError: class extends Error {},
}));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { deleteTaskWithHistory: vi.fn(async () => ({ deleted: true })) } }));
vi.mock('../../services/followSuccessors', () => ({ moveSuccessorsAfter: vi.fn() }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute: vi.fn(async () => ({ deltas: [] })) } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: { evaluate: vi.fn(async () => ({ allowed: true, matchedPolicies: [] })) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: {} }));
vi.mock('../../services/KnowledgeBaseService', () => ({ knowledgeBaseService: {} }));
vi.mock('../../utils/portfolioChanges', () => ({ markCurrentCompanyChanged: vi.fn() }));

import { AIActionExecutor } from '../../services/aiActionExecutor';
import { scheduleService } from '../../services/ScheduleService';
import { changeHistoryService } from '../../services/ChangeHistoryService';
import { scheduleRecomputeService } from '../../services/ScheduleRecomputeService';

const ss = scheduleService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const del = changeHistoryService.deleteTaskWithHistory as unknown as ReturnType<typeof vi.fn>;
const recompute = scheduleRecomputeService.recompute as unknown as ReturnType<typeof vi.fn>;
const CTX = { userId: 'u1', userRole: 'admin' };

const dep = (id: string) => ({ dependencyId: id, dependencyType: 'FS', lagDays: 0 });
const task = (id: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id, name, scheduleId: 's1', sortOrder, parentTaskId: undefined, dependencies: [] as any[], estimatedDays: 4, priority: 'medium', ...extra,
});

describe('Mjuzi split_task', () => {
  const executor = new AIActionExecutor() as any;
  let n = 0;
  const original = task('orig', 'Gate 1 review and acceptance', 4, { parentTaskId: 'ph1', dependencies: [dep('before')], estimatedDays: 10, startDate: '2026-07-22', assignedTo: 'ann', status: 'pending', progressPercentage: 0, description: 'old text' });
  // one follower finishes after the original (FS, with another link), one starts with it (SS)
  const after = task('after', 'Phase 2 kickoff', 5, { dependencies: [dep('orig'), dep('other')] });
  const sameStart = task('with', 'Prepare handover', 6, { dependencies: [{ dependencyId: 'orig', dependencyType: 'SS', lagDays: 0 }] });

  beforeEach(() => {
    vi.clearAllMocks();
    n = 0;
    ss.findTaskById.mockImplementation(async (id: string) => (id === 'orig' ? original : null));
    ss.createTask.mockImplementation(async (d: any) => ({ id: `new${++n}`, name: d.name, scheduleId: 's1', sortOrder: 5 + n, parentTaskId: d.parentTaskId, dependencies: [] }));
    ss.updateTask.mockResolvedValue({});
    ss.findTasksByScheduleId.mockResolvedValue([original, after, sameStart]);
  });

  it('keeps the original as the first part, adds the others right after it, and moves the finish-followers to the last part', async () => {
    const r = await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'Review' }, { name: 'Revisions' }, { name: 'Acceptance' }] }, CTX);

    expect(r.success).toBe(true);
    // the original is renamed and shortened — nothing is deleted, so its dates, assignee and History stay
    expect(ss.updateTask).toHaveBeenNthCalledWith(1, 'orig', { name: 'Review', description: 'old text', estimatedDays: 3 });
    const calls = ss.createTask.mock.calls.map(c => c[0]);
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.afterTaskId)).toEqual(['orig', 'new1']);
    expect(calls.every(c => c.parentTaskId === 'ph1' && c.assignedTo === 'ann')).toBe(true);
    expect(calls[0].dependencies).toEqual([dep('orig')]);
    expect(calls[1].dependencies).toEqual([dep('new1')]);
    expect(calls.map(c => c.estimatedDays)).toEqual([3, 4]); // 10 days shared 3 + 3 + 4
    // the finish-follower follows the LAST part and keeps its other link; the start-follower is left alone
    expect(ss.updateTask).toHaveBeenCalledWith('after', { dependencies: [dep('new2'), dep('other')] });
    expect(ss.updateTask.mock.calls.some(c => c[0] === 'with')).toBe(false);
    // dates are re-flowed once, from the original
    expect(recompute).toHaveBeenCalledWith('s1', { onlyFrom: ['orig'] });
    expect(del).not.toHaveBeenCalled();
    expect(r.data.pieces.map((p: any) => p.name)).toEqual(['Review', 'Revisions', 'Acceptance']);
    expect(r.summary).toMatch(/The first part is the original task/);
  });

  it('uses the durations the user gave, within 1–365 days', async () => {
    await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'A', estimatedDays: 2 }, { name: 'B', estimatedDays: 9999 }, { name: 'C', estimatedDays: 0 }] }, CTX);
    expect(ss.updateTask).toHaveBeenNthCalledWith(1, 'orig', expect.objectContaining({ estimatedDays: 2 }));
    expect(ss.createTask.mock.calls.map(c => c[0].estimatedDays)).toEqual([365, 1]);
  });

  it('puts everything back when a part fails to save', async () => {
    ss.createTask.mockImplementationOnce(async () => ({ id: 'new1', name: 'B', dependencies: [] }))
      .mockImplementationOnce(async () => { throw new Error('assignee not in this client\'s pool'); });
    const r = await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }, CTX);

    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/Nothing was split/);
    expect(ss.deleteTask).toHaveBeenCalledWith('new1');
    // the original gets its own name, text and length back
    expect(ss.updateTask).toHaveBeenLastCalledWith('orig', { name: original.name, description: 'old text', estimatedDays: 10 });
  });

  it('restores the links of followers already moved when a later step fails, and does not claim it is unchanged if undo fails', async () => {
    const f1 = task('f1', 'Follower 1', 7, { dependencies: [dep('orig')] });
    const f2 = task('f2', 'Follower 2', 8, { dependencies: [dep('orig')] });
    ss.findTasksByScheduleId.mockResolvedValue([original, f1, f2]);
    ss.updateTask.mockImplementation(async (id: string) => { if (id === 'f2') throw new Error('lock timeout'); return {}; });
    const r = await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'A' }, { name: 'B' }] }, CTX);

    expect(r.success).toBe(false);
    // follower 1 had been moved to the last part; it is pointed back at the original
    expect(ss.updateTask).toHaveBeenCalledWith('f1', { dependencies: [dep('orig')] });
    expect(ss.deleteTask).toHaveBeenCalledWith('new1');

    // and when the undo itself fails, the reply says so
    ss.updateTask.mockImplementation(async (id: string) => { if (id !== 'orig' || ss.updateTask.mock.calls.length > 0) throw new Error('db down'); return {}; });
    const r2 = await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'A' }, { name: 'B' }] }, CTX);
    expect(r2.summary).toMatch(/could not be put back/);
  });

  it('refuses a phase, a milestone, a started task, a missing task and the wrong number of parts', async () => {
    const two = [{ name: 'A' }, { name: 'B' }];
    ss.findTaskById.mockResolvedValueOnce({ ...original, isSummary: true });
    expect((await executor.splitTask({ taskId: 'orig', pieces: two }, CTX)).summary).toMatch(/is a phase/);
    ss.findTaskById.mockResolvedValueOnce({ ...original, isMilestone: true });
    expect((await executor.splitTask({ taskId: 'orig', pieces: two }, CTX)).summary).toMatch(/is a milestone/);
    ss.findTaskById.mockResolvedValueOnce({ ...original, status: 'in_progress', progressPercentage: 40 });
    expect((await executor.splitTask({ taskId: 'orig', pieces: two }, CTX)).summary).toMatch(/already started/);
    expect((await executor.splitTask({ taskId: 'nope', pieces: two }, CTX)).success).toBe(false);
    expect((await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'only one' }] }, CTX)).summary).toMatch(/2 to 6/);
    expect((await executor.splitTask({ taskId: 'orig', pieces: [{ name: 'A' }, { name: '  ' }] }, CTX)).summary).toMatch(/needs a name/);
    expect(ss.createTask).not.toHaveBeenCalled();
    expect(ss.updateTask).not.toHaveBeenCalled();
  });
});

describe('Mjuzi set_dependency checks and list_tasks rows', () => {
  const executor = new AIActionExecutor() as any;
  // Phase 1 (row 1) holds Onboarding (row 2), Kick-off (row 3) and Governance (row 4)
  const phase = task('ph', 'Phase 1', 0, { isSummary: true });
  const onboarding = task('onb', 'Onboarding', 0, { parentTaskId: 'ph' });
  const kickoff = task('kick', 'Kick-off', 1, { parentTaskId: 'ph' });
  const governance = task('gov', 'Governance', 2, { parentTaskId: 'ph', dependencies: [dep('kick')] });
  const plan = [phase, onboarding, kickoff, governance];

  beforeEach(() => {
    vi.clearAllMocks();
    ss.findTaskById.mockImplementation(async (id: string) => plan.find(t => t.id === id) ?? null);
    ss.findTasksByScheduleId.mockResolvedValue(plan);
    ss.updateTask.mockResolvedValue({});
  });

  it('refuses a phase row as the predecessor, and changes nothing', async () => {
    const r = await executor.setDependency({ taskId: 'kick', predecessorId: 'ph' }, CTX);
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/is a phase/);
    expect(ss.updateTask).not.toHaveBeenCalled();
  });

  it('links a later row after an earlier one without a warning', async () => {
    const r = await executor.setDependency({ taskId: 'gov', predecessorId: 'onb' }, CTX);
    expect(r.success).toBe(true);
    expect(r.data.warning).toBeUndefined();
  });

  it('warns when the predecessor is further down the plan (Onboarding after Governance)', async () => {
    const r = await executor.setDependency({ taskId: 'onb', predecessorId: 'gov' }, CTX);
    expect(r.success).toBe(true); // legal, as in MS Project
    expect(r.data.warning).toMatch(/row 4, below "Onboarding" \(row 2\)/);
    expect(r.summary).toContain('WARNING');
  });

  it('list_tasks gives each task the row number the screen shows, in that order, with phase and predecessor rows', async () => {
    const r = await executor.listTasks({ scheduleId: 's1' }, CTX);
    expect(r.data.map((t: any) => [t.row, t.name, t.isPhase])).toEqual([
      [1, 'Phase 1', true], [2, 'Onboarding', false], [3, 'Kick-off', false], [4, 'Governance', false],
    ]);
    expect(r.data[3].predecessorRows).toEqual([3]);
  });
});
