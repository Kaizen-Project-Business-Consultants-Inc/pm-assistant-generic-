import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/DagWorkflowService', () => ({
  dagWorkflowService: {
    evaluateTaskChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://pm.kpbc.ca' },
}));

vi.mock('../../services/WebSocketService', () => ({
  WebSocketService: { sendToUser: vi.fn(), broadcast: vi.fn() },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('uuid', () => ({ v4: () => 'test-schedule-id' }));

import { ScheduleService } from '../../services/ScheduleService';

const svc = new ScheduleService();

const t = (id: string, sortOrder: number, deps: string[] = []) => ({
  id, scheduleId: 's1', name: `Task ${id}`, sortOrder, parentTaskId: null, startDate: null,
  dependencies: deps.map(d => ({ dependencyId: d, dependencyType: 'FS' as const, lagDays: 0 })),
}) as any;

let updateSpy: ReturnType<typeof vi.spyOn>;
function schedule(tasks: any[]) {
  vi.spyOn(svc, 'findTasksByScheduleId').mockResolvedValue(tasks);
  updateSpy = vi.spyOn(svc, 'updateTask').mockResolvedValue({} as any);
}

describe('bulkAddDependencies', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('chains tasks, keeping the links a task already has', async () => {
    schedule([t('a', 1), t('b', 2), t('c', 3, ['x']), t('x', 4)]);
    const res = await svc.bulkAddDependencies('s1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'b' },
    ]);
    expect(res.added).toHaveLength(2);
    expect(updateSpy).toHaveBeenCalledWith('c', { dependencies: [
      { dependencyId: 'x', dependencyType: 'FS', lagDays: 0 },
      { dependencyId: 'b', dependencyType: 'FS', lagDays: 0 },
    ] });
  });

  it('skips a link that already exists instead of duplicating it', async () => {
    schedule([t('a', 1), t('b', 2, ['a']), t('c', 3)]);
    const res = await svc.bulkAddDependencies('s1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'a' },
    ]);
    expect(res).toMatchObject({ skipped: 2 });
    expect(res.added).toEqual([{ taskId: 'c', dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }]);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the type and lag asked for', async () => {
    schedule([t('a', 1), t('b', 2)]);
    const res = await svc.bulkAddDependencies('s1', [{ taskId: 'b', dependencyId: 'a', dependencyType: 'SS', lagDays: 2 }]);
    expect(res.added[0]).toMatchObject({ dependencyType: 'SS', lagDays: 2 });
  });

  it('refuses a loop that only closes with the new links, naming the rows, and writes nothing', async () => {
    // row 1 already waits on row 3; chaining 1 → 2 → 3 closes the loop
    schedule([t('a', 1, ['c']), t('b', 2), t('c', 3)]);
    await expect(svc.bulkAddDependencies('s1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'b' },
    ])).rejects.toThrow(/loop: row \d → row \d → row \d → row \d\. Nothing was linked/);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses a self-link and a task from another schedule', async () => {
    schedule([t('a', 1), t('b', 2)]);
    await expect(svc.bulkAddDependencies('s1', [{ taskId: 'a', dependencyId: 'a' }])).rejects.toThrow(/row 1 \("Task a"\) cannot depend on itself/);
    await expect(svc.bulkAddDependencies('s1', [{ taskId: 'a', dependencyId: 'elsewhere' }])).rejects.toThrow(/must be in this schedule/);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refuses to push a task past 20 predecessors', async () => {
    const preds = Array.from({ length: 21 }, (_, i) => t(`p${i}`, i + 2));
    schedule([t('gate', 1), ...preds]);
    await expect(svc.bulkAddDependencies('s1', preds.map(p => ({ taskId: 'gate', dependencyId: p.id }))))
      .rejects.toThrow(/row 1 \("Task gate"\) would have more than 20 predecessors/);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does nothing when every link already exists', async () => {
    schedule([t('a', 1), t('b', 2, ['a'])]);
    expect(await svc.bulkAddDependencies('s1', [{ taskId: 'b', dependencyId: 'a' }])).toEqual({ added: [], skipped: 1 });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('bulkRemoveDependencies', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('removes exactly the listed links and leaves the rest', async () => {
    schedule([t('a', 1), t('b', 2), t('c', 3, ['a', 'b'])]);
    expect(await svc.bulkRemoveDependencies('s1', [{ taskId: 'c', dependencyId: 'b' }])).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith('c', { dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] });
  });

  it('ignores links that are already gone', async () => {
    schedule([t('a', 1), t('b', 2)]);
    expect(await svc.bulkRemoveDependencies('s1', [{ taskId: 'b', dependencyId: 'a' }, { taskId: 'zz', dependencyId: 'a' }])).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
