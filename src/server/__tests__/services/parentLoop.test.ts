import { describe, it, expect, vi, afterEach } from 'vitest';
import { isUnderItself, PARENT_LOOP_MESSAGE } from '../../utils/parentLoop';
import { scheduleService, DependencyValidationError } from '../../services/ScheduleService';
import { taskRepository } from '../../database/TaskRepository';

/**
 * Audit 2026-10-09 (H3): a task could be made a child of its own sub-task. P and C then formed a
 * loop with no top — tree screens dropped them and the summary roll-up rewrote both with each
 * other's figures. The single-task edit (task form, Gantt indent, MCP update-task, group / fix
 * proposals — all through updateTask → validateSameScheduleRef) now refuses it with a plain 400.
 */
const parents = (o: Record<string, string | null>) => new Map(Object.entries(o));

describe('isUnderItself', () => {
  const plan = parents({ P: null, C: 'P', G: 'C', Q: null });
  it('the task itself, its child, or any deeper sub-task is a loop', () => {
    expect(isUnderItself('P', 'P', plan)).toBe(true);
    expect(isUnderItself('P', 'C', plan)).toBe(true);
    expect(isUnderItself('P', 'G', plan)).toBe(true);
  });
  it('another branch, or the top, is not', () => {
    expect(isUnderItself('C', 'Q', plan)).toBe(false);
    expect(isUnderItself('G', 'P', plan)).toBe(false);
    expect(isUnderItself('P', null, plan)).toBe(false);
  });
  it('stops on a loop already in the data instead of walking forever', () => {
    expect(isUnderItself('X', 'A', parents({ A: 'B', B: 'A' }))).toBe(false);
  });
});

describe('single edit: validateSameScheduleRef', () => {
  afterEach(() => vi.restoreAllMocks());
  const plan: Record<string, { id: string; scheduleId: string; parentTaskId?: string }> = {
    P: { id: 'P', scheduleId: 's1' },
    C: { id: 'C', scheduleId: 's1', parentTaskId: 'P' },
    G: { id: 'G', scheduleId: 's1', parentTaskId: 'C' },
    Q: { id: 'Q', scheduleId: 's1' },
  };
  // the check walks up from the new parent one task at a time; it never reads the whole plan
  const stub = () => {
    vi.spyOn(taskRepository, 'parentLinks');
    return vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => (plan[id] ?? null) as any);
  };

  it('refuses putting P under its child or grandchild, with the plain message', async () => {
    stub();
    for (const target of ['C', 'G']) {
      const err = await scheduleService.validateSameScheduleRef('P', target, 's1', 'parent task').catch(e => e);
      expect(err).toBeInstanceOf(DependencyValidationError); // the route answers 400 with this message
      expect(err.message).toBe(PARENT_LOOP_MESSAGE);
    }
  });

  it('allows an ordinary move, reading only the tasks above the new parent (never the whole plan)', async () => {
    const reads = stub();
    await expect(scheduleService.validateSameScheduleRef('G', 'Q', 's1', 'parent task')).resolves.toBeUndefined();
    expect(reads.mock.calls.map(c => c[0])).toEqual(['Q']); // Q is at the top: it can't be under G
    reads.mockClear();
    await expect(scheduleService.validateSameScheduleRef('Q', 'G', 's1', 'parent task')).resolves.toBeUndefined();
    expect(reads.mock.calls.map(c => c[0])).toEqual(['G', 'C', 'P']); // G, then up: C, P
    expect(taskRepository.parentLinks).not.toHaveBeenCalled();
  });

  it('a new task (no id yet) is never checked for a loop', async () => {
    const reads = stub();
    await expect(scheduleService.validateSameScheduleRef(null, 'C', 's1', 'parent task')).resolves.toBeUndefined();
    expect(reads.mock.calls.map(c => c[0])).toEqual(['C']);
  });
});
