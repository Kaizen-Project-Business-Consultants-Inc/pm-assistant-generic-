import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mjuzi typed commands: a row number picks the task in the open plan, the change goes through the same tools
 * Mjuzi uses, and the change is recorded in Schedule History so the reply can offer Undo.
 */
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findTasksByScheduleId: vi.fn(),
    findTaskById: vi.fn(),
  },
}));
vi.mock('../../services/ChangeHistoryService', () => ({
  changeHistoryService: { record: vi.fn(async () => 'chg1'), readPrevious: vi.fn(async () => [{ id: 't5', values: { name: 'Old' } }]) },
}));

import { runChatCommand } from '../../services/chatCommands/runChatCommand';
import { parseChatCommand } from '../../services/chatCommands/parseChatCommand';
import { scheduleService } from '../../services/ScheduleService';
import { changeHistoryService } from '../../services/ChangeHistoryService';

const ss = scheduleService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const record = changeHistoryService.record as unknown as ReturnType<typeof vi.fn>;

const task = (id: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id, name, scheduleId: 's1', sortOrder, parentTaskId: undefined, dependencies: [] as any[], status: 'pending', priority: 'medium',
  progressPercentage: 0, startDate: '2026-10-05', endDate: '2026-10-09', ...extra,
});
const dep = (id: string) => ({ dependencyId: id, dependencyType: 'FS', lagDays: 0 });

// rows 1..4 by sortOrder: Kickoff(1), Design(2), Build(3, after Design), Test(4)
const plan = () => [
  task('t1', 'Kickoff', 1),
  task('t2', 'Design', 2),
  task('t3', 'Build', 3, { dependencies: [dep('t2')], startDate: '2026-10-12', endDate: '2026-10-16' }),
  task('t4', 'Test', 4),
];

const DESIGN_ID = '00000000-0000-4000-8000-000000000002';
/** the plan with Design (row 2) under a real-looking id, the way the Confirm button names it */
const planWithDesignId = () => plan().map(t => (t.id === 't2' ? { ...t, id: DESIGN_ID } : t));

const ctx = { userId: 'u1', userRole: 'admin', projectId: 'p1', scheduleId: 's1' };
const ok = (toolName: string, data: Record<string, unknown> = {}) => ({ success: true, toolName, summary: 'done', data });
const run = (text: string, executor: { execute: ReturnType<typeof vi.fn> }, c: Record<string, unknown> = ctx) =>
  runChatCommand(parseChatCommand(text)!, c as typeof ctx, executor as any);
const typed = (r: Awaited<ReturnType<typeof run>>) => r.actions[r.actions.length - 1];

let executor: { execute: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks();
  executor = { execute: vi.fn(async (tool: string) => ok(tool, { taskId: 't2', changeId: 'del1' })) };
  ss.findById.mockResolvedValue({ id: 's1', projectId: 'p1' });
  ss.findByProjectId.mockResolvedValue([{ id: 's1', projectId: 'p1' }]);
  ss.findTasksByScheduleId.mockResolvedValue(plan());
  ss.findTaskById.mockImplementation(async (id: string) => plan().find(t => t.id === id) ?? null);
});

describe('typed commands: which task, which plan', () => {
  it('says which rows exist when a row is missing, and changes nothing', async () => {
    const r = await run('delete task 99', executor);
    expect(r.reply).toBe('There is no task 99. This plan has tasks 1 to 4.');
    expect(typed(r).success).toBe(false);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('needs a project: on the dashboard it says to open one', async () => {
    const r = await run('delete task 1', executor, { ...ctx, projectId: undefined, scheduleId: undefined });
    expect(r.reply).toMatch(/Open a project's plan first/);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('uses the project\'s only plan when none is open, and refuses to guess between several', async () => {
    const noOpen = { ...ctx, scheduleId: undefined };
    expect((await run('delete task 1', executor, noOpen)).reply).toMatch(/^Delete task 1/);
    ss.findByProjectId.mockResolvedValue([{ id: 's1', projectId: 'p1' }, { id: 's2', projectId: 'p1' }]);
    expect((await run('delete task 1', executor, noOpen)).reply).toMatch(/more than one plan/);
  });

  it('ignores an open plan that belongs to another project', async () => {
    ss.findById.mockResolvedValue({ id: 's9', projectId: 'other' });
    ss.findByProjectId.mockResolvedValue([{ id: 's1', projectId: 'p1' }, { id: 's2', projectId: 'p1' }]);
    expect((await run('delete task 1', executor, { ...ctx, scheduleId: 's9' })).reply).toMatch(/more than one plan/);
    expect(ss.findTasksByScheduleId).not.toHaveBeenCalled();
  });
});

describe('typed commands: delete asks first', () => {
  it('names the task and what goes with it, and does not delete until Confirm', async () => {
    const r = await run('delete task 2', executor);
    expect(r.reply).toBe('Delete task 2, **Design**? Its 1 link will go too.');
    expect(typed(r).data).toEqual({ typed: true, pending: { taskId: 't2' } });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('Confirm deletes by id and offers the History entry as Undo', async () => {
    ss.findTasksByScheduleId.mockResolvedValue(planWithDesignId());
    ss.findTaskById.mockResolvedValue(planWithDesignId()[1]);
    const done = await run(`confirm delete ${DESIGN_ID}`, executor);
    expect(executor.execute).toHaveBeenCalledWith('delete_task', { taskId: DESIGN_ID }, { userId: 'u1', userRole: 'admin' });
    expect(done.reply).toBe('Deleted task 2, **Design**.');
    expect(typed(done).data).toEqual({ typed: true, undo: { scheduleId: 's1', changeId: 'del1', projectId: 'p1' } });
  });

  it('Confirm for a task that is already gone says so', async () => {
    ss.findTaskById.mockResolvedValue(null);
    expect((await run(`confirm delete ${DESIGN_ID}`, executor)).reply).toBe('That task is already gone.');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('Confirm for a task in another project does nothing', async () => {
    ss.findTaskById.mockResolvedValue({ ...plan()[1], scheduleId: 's7' });
    ss.findById.mockImplementation(async (id: string) => ({ id, projectId: id === 's7' ? 'other' : 'p1' }));
    const r = await run(`confirm delete ${DESIGN_ID}`, executor);
    expect(r.reply).toBe("That task isn't in this project.");
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('a team member is told only the PM can change it', async () => {
    ss.findTasksByScheduleId.mockResolvedValue(planWithDesignId());
    ss.findTaskById.mockResolvedValue(planWithDesignId()[1]);
    executor.execute.mockResolvedValue({ success: false, toolName: 'delete_task', summary: "Only the project's Manager or Owner can change it, so I didn't make that change.", error: 'Not allowed' });
    const r = await run(`confirm delete ${DESIGN_ID}`, executor);
    expect(r.reply).toBe('Only the PM can change this.');
    expect(typed(r).success).toBe(false);
  });
});

describe('typed commands: edits record History so Undo works', () => {
  it('rename: one update_task, old value kept for Undo', async () => {
    const r = await run('rename 2 to "Detailed design"', executor);
    expect(executor.execute).toHaveBeenCalledWith('update_task', { taskId: 't2', name: 'Detailed design' }, expect.anything());
    expect(r.reply).toBe('Renamed.\nDesign → Detailed design');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'bulk_update', scheduleId: 's1', projectId: 'p1', taskIds: ['t2'], undo: { previous: [{ id: 't5', values: { name: 'Old' } }], moved: [] },
    }));
    expect(typed(r).data).toEqual({ typed: true, undo: { scheduleId: 's1', changeId: 'chg1', projectId: 'p1' } });
  });

  it('a change that changes nothing says so and writes nothing', async () => {
    expect((await run('rename 2 to "Design"', executor)).reply).toMatch(/already called/);
    expect((await run('task 1 status not started', executor)).reply).toMatch(/already not started/);
    expect((await run('task 1 priority medium', executor)).reply).toMatch(/already has medium/);
    expect((await run('task 1 progress 0', executor)).reply).toMatch(/already at 0%/);
    expect((await run('task 1 start 2026-10-05', executor)).reply).toMatch(/already starts on 5 Oct/);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('status, priority and progress use update_task with the right field', async () => {
    await run('task 1 status in progress', executor);
    await run('task 1 priority urgent', executor);
    ss.findTaskById.mockResolvedValue({ ...plan()[0], progressPercentage: 60 }); // the task keeps what was typed
    await run('task 1 progress 60', executor);
    expect(executor.execute.mock.calls.map(c => [c[0], c[1]])).toEqual([
      ['update_task', { taskId: 't1', status: 'in_progress' }],
      ['update_task', { taskId: 't1', priority: 'urgent' }],
      ['update_task', { taskId: 't1', progressPercentage: 60 }],
    ]);
  });

  it('a phase row has no status, progress or dates of its own', async () => {
    ss.findTasksByScheduleId.mockResolvedValue([task('ph', 'Phase 1', 1, { isSummary: true }), task('c', 'Child', 2, { parentTaskId: 'ph' })]);
    expect((await run('task 1 status completed', executor)).reply).toMatch(/is a phase/);
    expect((await run('task 1 start 2026-11-01', executor)).reply).toMatch(/is a phase/);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('a date that puts the end before the start is refused', async () => {
    const r = await run('task 1 end 2026-10-01', executor);
    expect(r.reply).toBe('Not changed: that would finish task 1 (1 Oct) before it starts (5 Oct).');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('moving a date that pushes later tasks uses the tool own History entry (one entry, so Undo works), not a second one', async () => {
    executor.execute.mockResolvedValue(ok('reschedule_task', { changeId: 'cas1', affectedTasks: [{ id: 't3' }] }));
    const r = await run('task 2 end 2026-10-19', executor);
    expect(executor.execute).toHaveBeenCalledWith('reschedule_task', { taskId: 't2', endDate: '2026-10-19' }, expect.anything());
    expect(r.reply).toBe('Done. task 2, **Design** now ends on 19 Oct. 1 later task moved to follow.');
    expect(record).not.toHaveBeenCalled();
    expect(typed(r).data).toEqual({ typed: true, undo: { scheduleId: 's1', changeId: 'cas1', projectId: 'p1' } });
  });

  it('moving a date that pushes nothing records its own entry, with the phase rows that rolled up', async () => {
    executor.execute.mockResolvedValue(ok('reschedule_task', { changeId: null, affectedTasks: [] }));
    ss.findTasksByScheduleId
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(plan().map(t => (t.id === 't4' ? { ...t, endDate: '2026-10-12' } : t)));
    const r = await run('task 2 end 2026-10-08', executor);
    expect(r.reply).toBe('Done. task 2, **Design** now ends on 8 Oct.');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'bulk_update', taskIds: ['t2', 't4'],
      undo: expect.objectContaining({ moved: [{ taskId: 't4', startDate: '2026-10-05', endDate: '2026-10-09' }] }),
    }));
  });

  it('a progress the task does not keep (it comes from approved hours) is said, and writes no History', async () => {
    ss.findTaskById.mockResolvedValue({ ...plan()[0], progressPercentage: 0 });
    const r = await run('task 1 progress 60', executor);
    expect(r.reply).toMatch(/progress comes from its approved hours/);
    expect(typed(r).success).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  it('a refused edit changes nothing in History', async () => {
    executor.execute.mockResolvedValue({ success: false, toolName: 'update_task', summary: 'Blocked by policy: Freeze', error: 'Action blocked by policy' });
    const r = await run('task 1 status completed', executor);
    expect(r.reply).toBe('Not changed. Blocked by policy: Freeze');
    expect(record).not.toHaveBeenCalled();
  });
});

describe('typed commands: links', () => {
  it('link A to B makes B wait for A, remembers B\'s old links, says how B moved', async () => {
    ss.findTasksByScheduleId
      .mockResolvedValueOnce(plan())
      .mockResolvedValueOnce(plan().map(t => (t.id === 't4' ? { ...t, startDate: '2026-10-20', endDate: '2026-10-24', dependencies: [dep('t1')] } : t)));
    const r = await run('link 1 to 4', executor);
    expect(executor.execute).toHaveBeenCalledWith('set_dependency', { taskId: 't4', predecessorId: 't1' }, expect.anything());
    expect(r.reply).toBe('Linked. **Kickoff** (1) must finish before **Test** (4) starts. Test moves from 5 Oct to 20 Oct.');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'bulk_update',
      undo: { previous: [], links: [{ taskId: 't4', deps: [] }], moved: [{ taskId: 't4', startDate: '2026-10-05', endDate: '2026-10-09' }] },
    }));
  });

  it('a link that already exists, or a loop, changes nothing', async () => {
    expect((await run('link 2 to 3', executor)).reply).toMatch(/are already linked/);
    executor.execute.mockResolvedValue({ success: false, toolName: 'set_dependency', summary: 'This link would make a loop', error: 'x' });
    const loop = await run('link 3 to 2', executor);
    expect(loop.reply).toBe('Not linked. This link would make a loop');
    expect(record).not.toHaveBeenCalled();
  });

  it('unlink removes it; a link that is not there is said, not tried', async () => {
    const r = await run('unlink 2 from 3', executor);
    expect(executor.execute).toHaveBeenCalledWith('remove_dependency', { taskId: 't3', predecessorId: 't2' }, expect.anything());
    expect(r.reply).toBe('Unlinked. **Build** (3) no longer waits for **Design** (2).');
    executor.execute.mockClear();
    expect((await run('unlink 1 from 4', executor)).reply).toMatch(/are not linked that way/);
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

describe('typed commands: add a task, help', () => {
  it('adds at the end with its days, and Undo deletes just that task', async () => {
    executor.execute.mockResolvedValue(ok('create_task', { taskId: 'new' }));
    ss.findTasksByScheduleId.mockResolvedValueOnce(plan()).mockResolvedValueOnce([...plan(), task('new', 'Training', 5)]);
    const r = await run('add task "Training" 3 days', executor);
    expect(executor.execute).toHaveBeenCalledWith('create_task', { scheduleId: 's1', name: 'Training', estimatedDays: 3 }, expect.anything());
    expect(r.reply).toBe('Added task 5, **Training**, 3 days.');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bulk_create', undo: { createdIds: ['new'] } }));
  });

  it('help lists the commands and never touches the plan', async () => {
    const r = await runChatCommand(parseChatCommand('help')!, ctx, executor as any);
    expect(r.reply).toMatch(/delete task 5/);
    expect(ss.findTasksByScheduleId).not.toHaveBeenCalled();
  });
});
