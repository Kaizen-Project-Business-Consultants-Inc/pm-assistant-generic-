import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mjuzi's indent_tasks (2026-10-29): moves EXISTING tasks under another heading with the Gantt's
 * meaning (indent = under the row above the first task, outdent = up one level), refuses loops,
 * other schedules and people who can't edit the project, and asks first above 3 tasks.
 */
const checkRole = vi.fn(async () => ({ ok: true }));
vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: (...a: any[]) => (checkRole as any)(...a) }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTaskById: vi.fn(),
    findTasksByScheduleId: vi.fn(),
    findById: vi.fn(async () => ({ id: 's1', projectId: 'p1', name: 'Plan' })),
  },
  DependencyValidationError: class extends Error {},
}));
const reparent = vi.fn(async (..._a: any[]) => ({ changeId: 'chg-1' } as { changeId: string | null }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { reparentTasksWithHistory: (...a: any[]) => (reparent as any)(...a) } }));
const findByIds = vi.fn();
vi.mock('../../database/TaskRepository', () => ({ taskRepository: { findByIds: (...a: any[]) => findByIds(...a) } }));
vi.mock('../../services/followSuccessors', () => ({ moveSuccessorsAfter: vi.fn() }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute: vi.fn() } }));
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

const ss = scheduleService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const CTX = { userId: 'u1', userRole: 'project_manager' };
const executor = new AIActionExecutor();

const t = (id: string, name: string, sortOrder: number, parentTaskId?: string) =>
  ({ id, name, scheduleId: 's1', sortOrder, parentTaskId, dependencies: [] as any[] });

// rows as the schedule screen shows them:
//  1 h1 Phase A    2 a    3 b        4 h2 Phase B    5 c        6 d   7 e   8 f   9 g
const PLAN = [
  t('h1', 'Phase A', 1), t('a', 'Task A', 1, 'h1'), t('b', 'Task B', 2, 'h1'),
  t('h2', 'Phase B', 2), t('c', 'Task C', 1, 'h2'),
  t('d', 'Task D', 3), t('e', 'Task E', 4), t('f', 'Task F', 5), t('g', 'Task G', 6),
];

beforeEach(() => {
  vi.clearAllMocks();
  checkRole.mockResolvedValue({ ok: true });
  ss.findTaskById.mockImplementation(async (id: string) => PLAN.find(p => p.id === id) ?? null);
  ss.findTasksByScheduleId.mockResolvedValue(PLAN);
  findByIds.mockImplementation(async (ids: string[]) => PLAN.filter(p => ids.includes(p.id)));
});

describe('Mjuzi indent_tasks', () => {
  it('indent puts a task under the row above it, like the Tab key', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent' }, CTX);

    expect(r.success).toBe(true);
    expect(reparent).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', scheduleId: 's1', moves: [{ id: 'd', parentId: 'c' }] }));
    expect(r.summary).toMatch(/row 6 "Task D" → under row 5 "Task C"/);
    expect(r.data.changeId).toBe('chg-1'); // the History line Undo reverses
  });

  it('indent of several tasks puts them all under the row above the FIRST one', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['e', 'd'], direction: 'indent' }, CTX);

    expect(r.success).toBe(true);
    expect(reparent.mock.calls[0][0].moves).toEqual([{ id: 'd', parentId: 'c' }, { id: 'e', parentId: 'c' }]);
  });

  it('indent leaves a task that is already under the row above, and one whose own heading is also named', async () => {
    const already = await executor.execute('indent_tasks', { taskIds: ['a'], direction: 'indent' }, CTX); // above a is h1, its parent
    expect(already.success).toBe(true);
    expect(already.data.moved).toEqual([]);
    expect(reparent).not.toHaveBeenCalled();

    // d goes under c; e is not its child so it follows; but a (under h1) and b (under h1) with h1 named: they stay with h1
    await executor.execute('indent_tasks', { taskIds: ['h2', 'c'], direction: 'indent' }, CTX); // c is under h2, which is also named
    expect(reparent.mock.calls[0][0].moves).toEqual([{ id: 'h2', parentId: 'b' }]);
  });

  it('outdent moves each task up one level (the parent\'s parent, or the top)', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['a', 'c', 'd'], direction: 'outdent' }, CTX);

    expect(r.success).toBe(true);
    // d is already at the top: left alone
    expect(reparent.mock.calls[0][0].moves).toEqual([{ id: 'a', parentId: null }, { id: 'c', parentId: null }]);
    expect(reparent.mock.calls[0][0].summary).toMatch(/^Outdented 2 tasks up one level/);
  });

  it('moves tasks under a named heading', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['d', 'a'], underTaskId: 'h2' }, CTX);

    expect(r.success).toBe(true);
    expect(reparent.mock.calls[0][0].moves).toEqual([{ id: 'a', parentId: 'h2' }, { id: 'd', parentId: 'h2' }]);
  });

  it('a heading moved under its own sub-task is refused by the save (nothing moved); a task under itself is refused up front', async () => {
    reparent.mockRejectedValueOnce(Object.assign(new Error("A task can't be moved under one of its own sub-tasks."), { refused: true }));
    const loop = await executor.execute('indent_tasks', { taskIds: ['h1'], underTaskId: 'a' }, CTX);
    expect(loop.success).toBe(false);
    expect(loop.summary).toMatch(/own sub-tasks.*Nothing was moved/);

    const self = await executor.execute('indent_tasks', { taskIds: ['d', 'e'], underTaskId: 'e' }, CTX);
    expect(self.success).toBe(false);
    expect(reparent).toHaveBeenCalledTimes(1);
  });

  it('refuses a heading the moved task is linked to (either direction), or that a task under it is linked to', async () => {
    const link = (id: string) => ({ dependencyId: id });
    // d waits for h2; c (under h2) waits for a (under h1)
    const withLinks = PLAN.map(p => (p.id === 'd' ? { ...p, dependencies: [link('h2')] } : p.id === 'c' ? { ...p, dependencies: [link('a')] } : p));
    ss.findTasksByScheduleId.mockResolvedValue(withLinks);

    const direct = await executor.execute('indent_tasks', { taskIds: ['d'], underTaskId: 'h2' }, CTX);
    expect(direct.success).toBe(false);
    expect(direct.summary).toMatch(/Task D is linked to Phase B; remove the link first/);

    // a heading whose part is linked to the new heading's part: h1 holds a; c (under h2) is linked to a
    const viaPart = await executor.execute('indent_tasks', { taskIds: ['h1'], underTaskId: 'c' }, CTX);
    expect(viaPart.success).toBe(false);
    expect(viaPart.summary).toMatch(/is linked to/);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('refuses a milestone as the new heading', async () => {
    ss.findTasksByScheduleId.mockResolvedValue(PLAN.map(p => (p.id === 'c' ? { ...p, isMilestone: true } : p)));
    const r = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent' }, CTX); // above d is c
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/milestone/);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('refuses a task or heading from another schedule', async () => {
    const stray = { id: 'x', name: 'Elsewhere', scheduleId: 's2' };
    ss.findTaskById.mockImplementation(async (id: string) => (id === 'x' ? stray : PLAN.find(p => p.id === id) ?? null));
    findByIds.mockImplementation(async (ids: string[]) => [...PLAN, stray].filter(p => ids.includes(p.id)));
    ss.findById.mockImplementation(async (id: string) => ({ id, projectId: id === 's2' ? 'p2' : 'p1' }));

    // a task of another plan, same project or not: not moved
    const otherPlanTask = await executor.execute('indent_tasks', { taskIds: ['d', 'x'], direction: 'indent' }, CTX);
    expect(otherPlanTask.success).toBe(false);
    // a heading of another plan
    const otherHeading = await executor.execute('indent_tasks', { taskIds: ['d'], underTaskId: 'x' }, CTX);
    expect(otherHeading.success).toBe(false);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('refuses ids that do not exist', async () => {
    findByIds.mockResolvedValue([]);
    const r = await executor.execute('indent_tasks', { taskIds: ['nope'], direction: 'indent' }, CTX);
    expect(r.success).toBe(false);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('more than 3 moves: lists them and asks first; moves nothing until userConfirmed', async () => {
    const asked = await executor.execute('indent_tasks', { taskIds: ['d', 'e', 'f', 'g'], direction: 'indent' }, CTX);

    expect(asked.success).toBe(false);
    expect(reparent).not.toHaveBeenCalled();
    expect(asked.data.needsConfirmation).toBe(true);
    expect(asked.summary).toMatch(/needs the user's OK/);
    expect(asked.summary).toMatch(/row 9 "Task G" → under row 5 "Task C"/);

    const sure = await executor.execute('indent_tasks', { taskIds: ['d', 'e', 'f', 'g'], direction: 'indent', userConfirmed: true }, CTX);
    expect(sure.success).toBe(true);
    expect(reparent.mock.calls[0][0].moves).toHaveLength(4);
  });

  it('inside a chat the yes counts only for the list shown in the previous message', async () => {
    const four = { taskIds: ['d', 'e', 'f', 'g'], direction: 'indent' };
    const shown = await executor.execute('indent_tasks', four, { ...CTX, approvedMoves: new Set<string>() });
    const key = shown.data.proposalKey;
    expect(key).toMatch(/^[0-9a-f]{64}$/);

    // a yes the model made up in the same turn: the set holds nothing, so it is ignored
    const invented = await executor.execute('indent_tasks', { ...four, userConfirmed: true }, { ...CTX, approvedMoves: new Set<string>() });
    expect(invented.success).toBe(false);
    expect(invented.data.needsConfirmation).toBe(true);
    expect(reparent).not.toHaveBeenCalled();
    // a different list under the same yes is a different key
    const other = await executor.execute('indent_tasks', { taskIds: ['d', 'e', 'f', 'g'], underTaskId: 'h2', userConfirmed: true }, { ...CTX, approvedMoves: new Set([key]) });
    expect(other.success).toBe(false);
    expect(reparent).not.toHaveBeenCalled();

    // the user's yes in the next message: the stored key matches, once
    const approved = new Set([key]);
    const yes = await executor.execute('indent_tasks', { ...four, userConfirmed: true }, { ...CTX, approvedMoves: approved });
    expect(yes.success).toBe(true);
    expect(reparent.mock.calls[0][0].moves).toHaveLength(4);
    const again = await executor.execute('indent_tasks', { ...four, userConfirmed: true }, { ...CTX, approvedMoves: approved });
    expect(again.success).toBe(false); // the yes was used up
  });

  it('a move that cannot be saved says why and that nothing moved; no undo promise without a History line', async () => {
    reparent.mockRejectedValueOnce(Object.assign(new Error('That would nest tasks more than 10 levels deep.'), { refused: true }));
    const refused = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent' }, CTX);
    expect(refused.success).toBe(false);
    expect(refused.summary).toMatch(/10 levels deep.*Nothing was moved/);

    reparent.mockResolvedValueOnce({ changeId: null });
    const noLine = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent' }, CTX);
    expect(noLine.success).toBe(true);
    expect(noLine.summary).not.toMatch(/Schedule History can undo/);
  });

  it('exactly 3 moves need no question', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['d', 'e', 'f'], direction: 'indent' }, CTX);
    expect(r.success).toBe(true);
    expect(reparent).toHaveBeenCalledTimes(1);
  });

  it('a viewer or team member (not the project\'s Manager) cannot move tasks', async () => {
    checkRole.mockResolvedValue({ ok: false });
    const r = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent' }, CTX);

    expect(r.success).toBe(false);
    expect(r.error).toBe('Not allowed');
    expect(reparent).not.toHaveBeenCalled();
  });

  it('needs exactly one of direction / underTaskId, and at most 50 tasks', async () => {
    const neither = await executor.execute('indent_tasks', { taskIds: ['d'] }, CTX);
    const both = await executor.execute('indent_tasks', { taskIds: ['d'], direction: 'indent', underTaskId: 'h2' }, CTX);
    const none = await executor.execute('indent_tasks', { taskIds: [], direction: 'indent' }, CTX);
    expect([neither.success, both.success, none.success]).toEqual([false, false, false]);

    // 51 ids: the project check only looks up the first 51 and the tool refuses the list
    findByIds.mockImplementation(async (ids: string[]) => ids.map(id => ({ id, scheduleId: 's1' })));
    const many = await executor.execute('indent_tasks', { taskIds: Array.from({ length: 51 }, (_, i) => `x${i}`), direction: 'indent' }, CTX);
    expect(many.success).toBe(false);
    expect(many.summary).toMatch(/at most 50/);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('refuses indent when there is no row above the first task', async () => {
    const r = await executor.execute('indent_tasks', { taskIds: ['h1'], direction: 'indent' }, CTX);
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/no row above/);
  });
});
