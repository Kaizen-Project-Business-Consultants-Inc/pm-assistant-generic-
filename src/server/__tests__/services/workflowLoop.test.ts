import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The workflow loop (found 2026-10-08): the seed workflow "Auto-complete on 100% progress" set
 * status = completed, which saved the task, which re-ran every workflow; progress was still 100 so
 * it matched again — 66,000 runs in 82 minutes on staging, ~15 task saves a second, until a
 * restart. Prod had the same workflows switched on in every company. Four things stop it now.
 */
const repo = vi.hoisted(() => ({
  checkTablesExist: vi.fn(async () => true),
  findEnabledDefinitions: vi.fn(async () => []),
}));
vi.mock('../../database/WorkflowRepository', () => ({ workflowRepository: repo }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { matchesTrigger, executeAction } from '../../services/dagWorkflow/engine';
import { dagWorkflowService } from '../../services/DagWorkflowService';
import { runAsWorkflow } from '../../middleware/requestContext';

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', scheduleId: 's1', name: 'T', status: 'in_progress', progressPercentage: 50,
  endDate: '2026-01-05', dependencies: [], ...over,
}) as any;

describe('1. progress triggers fire when progress CROSSES the threshold', () => {
  const at100 = { triggerType: 'progress_threshold', progressThreshold: 100 };
  it('50 → 100 fires', () => expect(matchesTrigger(at100, task({ progressPercentage: 100 }), task())).toBe(true));
  it('100 → 100 (e.g. the workflow just set status) does not fire', () =>
    expect(matchesTrigger(at100, task({ progressPercentage: 100, status: 'completed' }), task({ progressPercentage: 100 }))).toBe(false));
  it('a new task already at 100 fires once', () => expect(matchesTrigger(at100, task({ progressPercentage: 100 }), null)).toBe(true));
  it('"below" works the same way', () => {
    const below20 = { triggerType: 'progress_threshold', progressThreshold: 20, progressDirection: 'below' };
    expect(matchesTrigger(below20, task({ progressPercentage: 10 }), task({ progressPercentage: 30 }))).toBe(true);
    expect(matchesTrigger(below20, task({ progressPercentage: 10 }), task({ progressPercentage: 15 }))).toBe(false);
  });
});

describe('2. "date passed" fires from the overdue scan or when the end date moves — not on every edit', () => {
  const passed = { triggerType: 'date_passed' };
  it('overdue scan (same task as old and new) fires', () => { const t = task(); expect(matchesTrigger(passed, t, t)).toBe(true); });
  it('renaming a late task does not', () => expect(matchesTrigger(passed, task({ name: 'New' }), task())).toBe(false));
  it('moving a late task to another past date does', () => expect(matchesTrigger(passed, task({ endDate: '2026-01-02' }), task())).toBe(true));
  it('a future date never fires', () => expect(matchesTrigger(passed, task({ endDate: '2099-01-01' }), null)).toBe(false));
});

describe('3. a field already set is not written again', () => {
  it('update_field skips when the task already has the value', async () => {
    const svc = { updateTask: vi.fn(async () => undefined) } as any;
    const r = await executeAction({ actionType: 'update_field', field: 'status', value: 'completed' }, task({ status: 'completed' }), svc);
    expect(r.skipped).toBe(true);
    expect(svc.updateTask).not.toHaveBeenCalled();
  });
  it('and writes it when it differs', async () => {
    const svc = { updateTask: vi.fn(async () => undefined) } as any;
    await executeAction({ actionType: 'update_field', field: 'status', value: 'completed' }, task(), svc);
    expect(svc.updateTask).toHaveBeenCalledWith('t1', { status: 'completed' });
  });
});

describe('4. workflows started by workflows stop at depth 3', () => {
  beforeEach(() => vi.clearAllMocks());
  it('a task change made three workflows deep starts nothing', async () => {
    await runAsWorkflow(() => runAsWorkflow(() => runAsWorkflow(() => dagWorkflowService.evaluateTaskChange(task(), task(), {} as any))));
    expect(repo.findEnabledDefinitions).not.toHaveBeenCalled();
  });
  it('an ordinary change (and one made by a single workflow) is evaluated', async () => {
    await dagWorkflowService.evaluateTaskChange(task(), task(), {} as any);
    await runAsWorkflow(() => dagWorkflowService.evaluateTaskChange(task(), task(), {} as any));
    expect(repo.findEnabledDefinitions).toHaveBeenCalledTimes(2);
  });
});

describe('5. a task save starts its workflows once, not twice', () => {
  it('the task route no longer calls the workflow engine itself (updateTask announces the change)', () => {
    const route = readFileSync(join(__dirname, '..', '..', 'routes', 'scheduling', 'schedules.ts'), 'utf-8');
    expect(route).not.toMatch(/evaluateTaskChange\(/);
    const svc = readFileSync(join(__dirname, '..', '..', 'services', 'ScheduleService.ts'), 'utf-8');
    expect(svc).toMatch(/taskChanged\(updated, oldTask\)/);
  });
});

describe('6. the real chain that looped: action → updateTask → task.changed → evaluateTaskChange', () => {
  beforeEach(() => vi.clearAllMocks());
  it('stops on its own: depth reaches the limit even though updateTask is not awaited', async () => {
    const depths: number[] = [];
    const { getRequestContext } = await import('../../middleware/requestContext');
    // a fake "updateTask" that does what the real one does: announces the change, which re-evaluates workflows
    const svc: any = {
      updateTask: vi.fn(async (id: string) => {
        depths.push(getRequestContext()?.workflowDepth ?? 0);
        await dagWorkflowService.evaluateTaskChange(task({ id, status: 'in_progress' }), task({ id }), svc);
        if ((getRequestContext()?.workflowDepth ?? 0) < 3) {
          await runAsWorkflow(() => executeAction({ actionType: 'update_field', field: 'status', value: 'completed' }, task({ id }), svc));
        }
      }),
    };
    await runAsWorkflow(() => executeAction({ actionType: 'update_field', field: 'status', value: 'completed' }, task(), svc));
    await new Promise<void>(r => { setTimeout(r, 50); }); // let the un-awaited writes run
    expect(depths).toEqual([1, 2, 3]); // each step one deeper, then it stops
    expect(repo.findEnabledDefinitions).toHaveBeenCalledTimes(2); // evaluated at depth 1 and 2, not at 3
  });
});
