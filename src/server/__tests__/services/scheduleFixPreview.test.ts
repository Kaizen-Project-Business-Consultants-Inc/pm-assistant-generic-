import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Propose fixes — preview (2026-10-18). The preview applies the ticked fixes to a copy of the plan
 * and re-flows it with the same forward pass Apply uses. Here the plan lives in an in-memory
 * "database" that Apply really writes to (links refused on a loop or a duplicate, a parent marked
 * a summary when a task goes under it, as the real services do), so the test checks both: the
 * preview saves nothing, and it predicts what Apply then does — tasks moved, finish, shift, score.
 */

const db = vi.hoisted(() => ({ tasks: [] as any[], seq: 0 }));
const clone = () => JSON.parse(JSON.stringify(db.tasks));
const byId = (id: string) => db.tasks.find(t => t.id === id);
const weekdays = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

vi.mock('../../config', () => ({ config: { AI_ENABLED: false } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn().mockResolvedValue({ id: 'p1', endDate: '2026-10-23' }) } }));
vi.mock('../../services/SprintService', () => ({ sprintService: { getByProject: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../services/ScheduleService', () => {
  const waits = (from: string, target: string, seen = new Set<string>()): boolean =>
    (byId(from)?.dependencies ?? []).some((d: any) => d.dependencyId === target || (!seen.has(d.dependencyId) && (seen.add(d.dependencyId), waits(d.dependencyId, target, seen))));
  // As the real roll-up: a task with tasks under it is a summary spanning them
  const rollUp = (parentTaskId?: string | null) => {
    const p = parentTaskId ? byId(parentTaskId) : null;
    if (!p) return;
    const kids = db.tasks.filter(t => t.parentTaskId === p.id);
    const starts = kids.map(k => k.startDate).filter(Boolean).sort();
    const ends = kids.map(k => k.endDate).filter(Boolean).sort();
    Object.assign(p, { isSummary: true, startDate: starts[0] ?? p.startDate, endDate: ends[ends.length - 1] ?? p.endDate });
    rollUp(p.parentTaskId);
  };
  const underParent = rollUp;
  return {
    scheduleService: {
      findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
      findTasksByScheduleId: vi.fn(async () => clone()),
      addDependency: vi.fn(async (taskId: string, depId: string, type: string, lag: number) => {
        const t = byId(taskId);
        if (!t || !byId(depId)) throw new Error('Task not found');
        if (t.dependencies.some((d: any) => d.dependencyId === depId)) throw new Error('duplicate');
        if (waits(depId, taskId)) throw new Error('circular dependency');
        t.dependencies.push({ dependencyId: depId, dependencyType: type, lagDays: lag });
      }),
      removeDependency: vi.fn(async (taskId: string, depId: string) => {
        const t = byId(taskId);
        t.dependencies = t.dependencies.filter((d: any) => d.dependencyId !== depId);
        return true;
      }),
      updateTask: vi.fn(async (id: string, v: any) => { Object.assign(byId(id), v); underParent(v.parentTaskId); return byId(id); }),
      createTask: vi.fn(async (data: any) => {
        const t = {
          id: `new-${++db.seq}`, name: data.name, status: data.status ?? 'pending', isSummary: false, isMilestone: !!data.isMilestone,
          parentTaskId: data.parentTaskId ?? null, startDate: data.startDate ?? null, endDate: data.endDate ?? null,
          estimatedDays: data.estimatedDays ?? null, dependencies: [],
        };
        db.tasks.push(t);
        underParent(t.parentTaskId);
        return t;
      }),
      deleteTask: vi.fn(),
      recomputeParentRollup: vi.fn(async (parentId: string) => rollUp(parentId)),
      workingDayTest: vi.fn(async () => weekdays),
    },
  };
});
vi.mock('../../services/CalendarService', () => ({
  calendarService: { workingDayChecker: vi.fn(async () => (ymd: string) => weekdays(new Date(ymd + 'T00:00:00Z'))) },
}));
vi.mock('../../database/TaskRepository', () => ({
  taskRepository: {
    updateDates: vi.fn(),
    updateDatesMany: vi.fn(async (list: any[]) => {
      for (const w of list) Object.assign(byId(w.id), { startDate: w.startDate, endDate: w.endDate });
    }),
  },
}));
vi.mock('../../services/BaselineService', () => ({ baselineService: { create: vi.fn().mockResolvedValue({ id: 'b1' }) } }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/claudeService', () => ({ claudeService: { isAvailable: () => false } }));
vi.mock('../../services/aiLearningService', () => ({ AILearningServiceV2: class { recordFeedback = vi.fn(); } }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u1', tenantDbName: 't1' }), getActorSource: () => 'web' }));
vi.mock('../../services/ScheduleReviewService', async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    scheduleReviewService: {
      latest: vi.fn().mockResolvedValue({ id: 'rev-0', score: 40 }),
      run: vi.fn().mockResolvedValue({ id: 'rev-1', score: 50, counts: {} }),
      // What the rules read, built from the in-memory plan (no float / resources in this test)
      gatherInput: vi.fn(async () => {
        const tasks = clone();
        return {
          tasks, projectId: 'p1',
          input: {
            schedule: { id: 's1' }, project: { endDate: '2026-10-23' }, sprintCount: 0, sprints: [],
            tasks: tasks.map(real.toReviewTask), resources: [], baselineCount: 0, latestBaselineTasks: null,
            floatByTask: null, overAllocations: null, today: new Date('2026-10-01T00:00:00Z'), isWorking: weekdays,
          },
        };
      }),
    },
  };
});
const repo = vi.hoisted(() => ({ findById: vi.fn(), markApplied: vi.fn() }));
vi.mock('../../database/ScheduleFixProposalRepository', () => ({ scheduleFixProposalRepository: repo }));

function task(id: string, start: string | null, end: string | null, over: any = {}) {
  return { id, name: id, status: 'pending', isSummary: false, isMilestone: false, parentTaskId: null, startDate: start, endDate: end, dependencies: [], ...over };
}
const link = (id: string, taskId: string, dependsOnTaskId: string, overlaps: boolean) =>
  ({ id, type: 'add_dependency', confidence: overlaps ? 0.5 : 0.75, reason: '', defaultChecked: false, taskId, dependsOnTaskId, dependencyType: 'FS', lagDays: 0, overlaps });

/** Each test asks about its own proposal, so nothing read for an earlier one is reused */
let fixes: any[] = [];
let proposalSeq = 0;
const nextProposal = () => `prop-${++proposalSeq}`;

async function service() {
  return (await import('../../services/ScheduleFixProposerService')).scheduleFixProposerService;
}

/** Preview, then Apply the same fixes to the same plan: they must agree */
async function expectParity(ids: string[]) {
  const svc = await service();
  const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
  const { reviewSchedule } = await import('../../services/scheduleReview/rules');
  const proposalId = nextProposal();
  const preview = await svc.preview('s1', proposalId, ids);
  const applied = await svc.apply('s1', proposalId, ids, 'u1');
  expect(applied.skipped).toEqual([]);
  expect(applied.datesMoved).toBe(preview.tasksMoved);
  expect(applied.projectEndBefore).toBe(preview.finishBefore);
  expect(applied.projectEndAfter).toBe(preview.finishAfter);
  expect(applied.projectEndShiftDays).toBe(preview.finishShiftDays);
  expect(preview.scoreAfter).toBe(reviewSchedule((await scheduleReviewService.gatherInput('s1')).input).score);
  return { preview, applied };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.seq = 0;
  // Oct 2026: Mon 5 … Fri 9, Mon 12 … Fri 16
  db.tasks = [
    task('a', '2026-10-05', '2026-10-09'),
    task('b', '2026-10-12', '2026-10-16'),
    task('c', '2026-10-12', '2026-10-16'),
    task('d', '2026-10-19', '2026-10-21'),
  ];
  fixes = [
    link('l-bc', 'c', 'b', true), // b and c run at the same time (Mon 12 – Fri 16)
    link('l-ab', 'b', 'a', false), // b starts after a finishes
  ];
  repo.findById.mockImplementation(async (id: string) => ({ id, scheduleId: 's1', projectId: 'p1', status: 'pending', proposalData: { fixes } }));
});

describe('Propose fixes — preview', () => {
  it('saves nothing', async () => {
    const before = clone();
    const { scheduleService } = await import('../../services/ScheduleService');
    const { taskRepository } = await import('../../database/TaskRepository');
    await (await service()).preview('s1', nextProposal(), ['l-bc', 'l-ab']);
    expect(db.tasks).toEqual(before);
    expect(scheduleService.addDependency).not.toHaveBeenCalled();
    expect(scheduleService.updateTask).not.toHaveBeenCalled();
    expect(scheduleService.createTask).not.toHaveBeenCalled();
    expect(taskRepository.updateDatesMany).not.toHaveBeenCalled();
    expect(repo.markApplied).not.toHaveBeenCalled();
  });

  it('predicts what Apply then does: tasks moved, finish, shift and score', async () => {
    const { preview } = await expectParity(['l-bc', 'l-ab']);
    expect(preview).toMatchObject({ tasksMoved: 1, finishBefore: '2026-10-21', finishAfter: '2026-10-23', finishShiftDays: 2, projectEnd: '2026-10-23' });
    expect(preview.scoreAfter).not.toBe(preview.scoreBefore);
    expect(byId('c')).toMatchObject({ startDate: '2026-10-19', endDate: '2026-10-23' });
  });

  it('links that follow the dates move nothing', async () => {
    const preview = await (await service()).preview('s1', nextProposal(), ['l-ab']);
    expect(preview).toMatchObject({ tasksMoved: 0, finishBefore: '2026-10-21', finishAfter: '2026-10-21', finishShiftDays: 0 });
  });

  it('a link and a split of the same task: the new link moves to the first part, not left on the summary', async () => {
    fixes = [
      link('l-bc', 'c', 'b', true),
      { id: 'split-c', type: 'split_task', taskId: 'c', taskName: 'c', parts: [{ name: 'c1', isMilestone: false, days: 2 }, { name: 'c2', isMilestone: false, days: 3 }] },
    ];
    await expectParity(['l-bc', 'split-c']);
    expect(byId('c')).toMatchObject({ isSummary: true, dependencies: [] }); // no link on a summary (R29)
    const first = db.tasks.find(t => t.name === 'c1');
    expect(first.dependencies.map((d: any) => d.dependencyId)).toEqual(['b']);
  });

  it('split after split: a link the first split moved is moved again by the second', async () => {
    db.tasks = [
      task('a', '2026-10-05', '2026-10-09'),
      task('b', '2026-10-12', '2026-10-16', { dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] }),
    ];
    const parts = (x: string) => [{ name: `${x}1`, isMilestone: false, days: 2 }, { name: `${x}2`, isMilestone: false, days: 3 }];
    // b first: its link to a moves to b1; then a: whoever waits on a now (b1) moves to a2
    fixes = [
      { id: 'split-b', type: 'split_task', taskId: 'b', taskName: 'b', parts: parts('b') },
      { id: 'split-a', type: 'split_task', taskId: 'a', taskName: 'a', parts: parts('a') },
    ];
    await expectParity(['split-b', 'split-a']);
    const named = (n: string) => db.tasks.find(t => t.name === n);
    expect(named('b1').dependencies.map((d: any) => d.dependencyId)).toEqual([named('a2').id]);
    expect(byId('a').dependencies).toEqual([]);
    expect(byId('b').dependencies).toEqual([]);
  });

  it('a link and a buffer for a gate that had no predecessor until the link', async () => {
    db.tasks.push(task('g', '2026-10-13', '2026-10-13', { isMilestone: true }));
    fixes = [link('l-ag', 'g', 'a', false), { id: 'buf-g', type: 'insert_buffer', gateTaskId: 'g', gateName: 'g', bufferDays: 2 }];
    const { preview } = await expectParity(['l-ag', 'buf-g']);
    const buffer = db.tasks.find(t => t.name === 'Buffer before g');
    expect(buffer).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-13' });
    expect(buffer.dependencies.map((d: any) => d.dependencyId)).toEqual(['a']);
    expect(byId('g').dependencies.map((d: any) => d.dependencyId)).toEqual([buffer.id]);
    expect(preview.tasksMoved).toBe(1); // the gate moves after the buffer
  });

  it('a missing phase added after a task pushes the one that waits for it', async () => {
    fixes = [{ id: 'add-t', type: 'add_task', phaseLabel: 'Testing', newTaskName: 'Test it', newTaskDays: 3, afterTaskId: 'a', beforeTaskId: 'b' }];
    const { preview } = await expectParity(['add-t']);
    expect(preview.finishShiftDays).toBe(0); // b moves to 15–21 Oct, no later than d already ends
    expect(preview.tasksMoved).toBe(1);
  });

  it('a new phase and a link in it', async () => {
    fixes = [
      link('l-bc', 'c', 'b', true),
      { id: 'grp-b', type: 'set_parent', taskId: 'b', newParentName: 'Build' },
      { id: 'grp-c', type: 'set_parent', taskId: 'c', newParentName: 'Build' },
    ];
    await expectParity(['l-bc', 'grp-b', 'grp-c']);
    expect(db.tasks.find(t => t.name === 'Build')).toMatchObject({ isSummary: true });
  });

  it('reads what the review needs once per proposal, then only the tasks', async () => {
    const svc = await service();
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    const { scheduleService } = await import('../../services/ScheduleService');
    const id = nextProposal();
    await svc.preview('s1', id, ['l-ab']);
    await svc.preview('s1', id, ['l-bc']);
    await svc.preview('s1', id, ['l-bc', 'l-ab']);
    expect(scheduleReviewService.gatherInput).toHaveBeenCalledTimes(1);
    expect(scheduleService.findTasksByScheduleId).toHaveBeenCalledTimes(3);
  });

  it('a failed load is not kept: both waiting previews get the error, the next one reads again', async () => {
    const svc = await service();
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    vi.mocked(scheduleReviewService.gatherInput).mockClear();
    vi.mocked(scheduleReviewService.gatherInput).mockRejectedValueOnce(new Error('pool busy'));
    const id = nextProposal();
    const results = await Promise.allSettled([svc.preview('s1', id, ['l-ab']), svc.preview('s1', id, ['l-bc'])]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
    await svc.preview('s1', id, ['l-ab']);
    expect(scheduleReviewService.gatherInput).toHaveBeenCalledTimes(2);
  });

  it('previews sent while the first is still loading share its read (U52, 2026-10-20)', async () => {
    const svc = await service();
    const { scheduleReviewService } = await import('../../services/ScheduleReviewService');
    vi.mocked(scheduleReviewService.gatherInput).mockClear();
    const id = nextProposal();
    await Promise.all([svc.preview('s1', id, ['l-ab']), svc.preview('s1', id, ['l-bc']), svc.preview('s1', id, ['l-ab', 'l-bc'])]);
    expect(scheduleReviewService.gatherInput).toHaveBeenCalledTimes(1);
  });

  it('a rename takes the name the PM typed', async () => {
    db.tasks.push(task('h', null, null, { name: 'T1', isSummary: true }));
    db.tasks[0].parentTaskId = 'h';
    fixes = [{ id: 'ren', type: 'rename_task', taskId: 'h', taskName: 'T1', newName: 'Task 1' }];
    const svc = await service();
    const id = nextProposal();
    const typed = await svc.preview('s1', id, ['ren'], { ren: 'Kick-off' });
    expect(typed.scoreAfter).toBeGreaterThanOrEqual(typed.scoreBefore);
  });

  it('refuses a proposal that is no longer pending, or another plan\'s', async () => {
    const svc = await service();
    repo.findById.mockResolvedValueOnce({ id: 'x', scheduleId: 's1', status: 'applied', proposalData: { fixes } });
    await expect(svc.preview('s1', 'x', ['l-ab'])).rejects.toThrow(/not pending/);
    repo.findById.mockResolvedValueOnce({ id: 'x', scheduleId: 'other', status: 'pending', proposalData: { fixes } });
    await expect(svc.preview('s1', 'x', ['l-ab'])).rejects.toThrow(/not found/);
  });
});

describe('applyFixesInMemory', () => {
  it('skips a link that would loop, as Apply does, and leaves its input alone', async () => {
    const { applyFixesInMemory } = await import('../../services/scheduleReview/fixPreview');
    const tasks = [task('a', '2026-10-05', '2026-10-09', { dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] }), task('b', '2026-10-01', '2026-10-02')];
    const out = applyFixesInMemory(tasks as any, [link('loop', 'b', 'a', true)] as any, weekdays);
    expect(out.find(t => t.id === 'b')!.dependencies).toEqual([]);
    expect(tasks[1].dependencies).toEqual([]);
  });
});
