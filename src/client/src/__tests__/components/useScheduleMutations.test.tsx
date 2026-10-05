/**
 * useScheduleMutations — ScheduleGantt's task changes, moved out of ScheduleTab.tsx unchanged
 * (code health item 4, phase 4 batch B, 2026-10-05). Each change must call the same API method
 * with the same payload, patch the same cache entry the same way, and invalidate the same
 * schedule-scoped keys (Lesson 5) as the inline code on c7082f09. The whole tab's DOM is checked
 * separately by scheduleTabDom.test.tsx.
 *
 * Note: the inline code never rolled an optimistic edit back when the save failed (onError only
 * announces); the tests pin that too, so a later change to it is a deliberate one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { GanttTask } from '../../components/schedule/GanttChart';

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createBaseline: vi.fn(),
  expandRecurrence: vi.fn(),
  undoScheduleChange: vi.fn(),
  restoreTaskDates: vi.fn(),
  bulkUpdateTasks: vi.fn(),
  bulkLinkTasks: vi.fn(),
  bulkUnlinkTasks: vi.fn(),
  groupTasks: vi.fn(),
  bulkDeleteTasks: vi.fn(),
  checkResourceLoad: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useScheduleMutations } from '../../pages/ProjectDetailPage/schedule-tab/useScheduleMutations';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Alpha', status: 'pending', priority: 'medium', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10, assignedTo: 'r1' },
  { id: 'b', name: 'Beta', status: 'in_progress', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20, parentTaskId: 'p' },
  { id: 'c', name: 'Gamma', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 30 },
];

let qc: QueryClient;
let invalidated: unknown[][];
const setters = () => ({ setShowAddForm: vi.fn(), setActiveTaskId: vi.fn(), setEditingTask: vi.fn() });

function setup(tasks: GanttTask[] = TASKS) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['tasks', 's1'], { data: tasks.map(t => ({ ...t })) });
  invalidated = [];
  const orig = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((f?: any) => { invalidated.push(f?.queryKey); return orig(f); });
  const s = setters();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useScheduleMutations({ schedule: { id: 's1' }, tasks, queryClient: qc, ...s }), { wrapper });
  return { ...hook, s };
}
const cached = () => (qc.getQueryData(['tasks', 's1']) as { data: GanttTask[] }).data;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.createTask.mockResolvedValue({ task: { id: 'new' } });
  api.updateTask.mockResolvedValue({ task: {} });
  api.deleteTask.mockResolvedValue({ changeId: 'ch1' });
  api.createBaseline.mockResolvedValue({});
  api.expandRecurrence.mockResolvedValue({});
  api.undoScheduleChange.mockResolvedValue({});
  api.restoreTaskDates.mockResolvedValue({});
  api.bulkUpdateTasks.mockResolvedValue({});
  api.bulkUnlinkTasks.mockResolvedValue({});
  api.checkResourceLoad.mockResolvedValue({ resourceId: 'r2', resourceName: 'Sam Builder', overWeeks: [] });
});
afterEach(() => { vi.restoreAllMocks(); });

const FORM = {
  name: 'New', description: '', status: 'pending', priority: 'high', assignedTo: '', startDate: '2026-03-02', endDate: '',
  progressPercentage: 0, parentTaskId: 'p', estimatedDays: '3', recurrenceRule: '', isRecurrenceTemplate: false, isMilestone: false,
  constraintType: 'ASAP', constraintDate: '', workHours: '7.5', effortDriven: false,
  assignments: [{ resourceId: '', allocationPct: 100 }, { resourceId: 'r2', allocationPct: 50 }],
  predecessors: [{ dependencyId: 'a', dependencyType: 'SS', lagDays: '2' }, { dependencyId: '', dependencyType: 'FS', lagDays: '0' }, { dependencyId: 'c', dependencyType: '', lagDays: 'x' }],
};

describe('create / update / delete / baseline mutations', () => {
  it('createMutation sends the same payload, closes the form, invalidates only this schedule\'s tasks', async () => {
    const { result, s } = setup();
    await act(async () => { await result.current.createMutation.mutateAsync({ ...FORM, afterTaskId: 'b' } as never); });
    expect(api.createTask).toHaveBeenCalledWith('s1', {
      name: 'New', description: undefined, status: 'pending', priority: 'high', assignedTo: undefined,
      startDate: '2026-03-02', endDate: undefined, progressPercentage: 0, parentTaskId: 'p', estimatedDays: 3,
      recurrenceRule: undefined, isRecurrenceTemplate: undefined, isMilestone: undefined, constraintType: undefined,
      constraintDate: undefined, workHours: 7.5, effortDriven: undefined,
      assignments: [{ resourceId: 'r2', allocationPct: 50 }],
      dependencies: [{ dependencyId: 'a', dependencyType: 'SS', lagDays: 2 }, { dependencyId: 'c', dependencyType: 'FS', lagDays: 0 }],
      afterTaskId: 'b', beforeTaskId: undefined,
    });
    expect(invalidated).toEqual([['tasks', 's1']]);
    expect(s.setShowAddForm).toHaveBeenCalledWith(false);
    expect(s.setActiveTaskId).toHaveBeenCalledWith(null);
    expect(api.expandRecurrence).not.toHaveBeenCalled();
  });

  it('createMutation expands a recurrence template, then refreshes again', async () => {
    api.createTask.mockResolvedValue({ task: { id: 'rt', isRecurrenceTemplate: true } });
    const { result } = setup();
    await act(async () => { await result.current.createMutation.mutateAsync({ ...FORM } as never); });
    await flush();
    expect(api.expandRecurrence).toHaveBeenCalledWith('s1', 'rt');
    expect(invalidated).toEqual([['tasks', 's1'], ['tasks', 's1']]);
  });

  it('updateMutation: a full form becomes the form payload (dependencies always sent); a partial patch goes as is', async () => {
    const { result, s } = setup();
    await act(async () => { await result.current.updateMutation.mutateAsync({ taskId: 'a', data: { ...FORM, predecessors: [] } as never }); });
    expect(api.updateTask).toHaveBeenLastCalledWith('s1', 'a', expect.objectContaining({ name: 'New', dependencies: [], estimatedDays: 3 }));
    expect(api.updateTask.mock.calls[0][2]).not.toHaveProperty('afterTaskId');
    await act(async () => { await result.current.updateMutation.mutateAsync({ taskId: 'a', data: { status: 'done' } }); });
    expect(api.updateTask).toHaveBeenLastCalledWith('s1', 'a', { status: 'done' });
    expect(invalidated).toEqual([['tasks', 's1'], ['tasks', 's1']]);
    expect(s.setEditingTask).toHaveBeenCalledWith(null);
  });

  it('a failed update is announced; the optimistic cache change is NOT rolled back and nothing is invalidated', async () => {
    api.updateTask.mockRejectedValue({ response: { data: { message: 'Nope' } } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, s } = setup();
    act(() => { result.current.updateTaskWithUndo('a', { name: 'Renamed' }); });
    await flush();
    expect(cached().find(t => t.id === 'a')!.name).toBe('Renamed');
    expect(invalidated).toEqual([]);
    expect(s.setEditingTask).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith('Task update failed:', 'Nope');
  });

  it('deleteMutation deletes, invalidates tasks + schedule-changes, and Undo goes through Schedule History', async () => {
    const { result, s } = setup();
    await act(async () => { await result.current.deleteMutation.mutateAsync('b'); });
    expect(api.deleteTask).toHaveBeenCalledWith('s1', 'b');
    expect(invalidated).toEqual([['tasks', 's1'], ['schedule-changes', 's1']]);
    expect(s.setEditingTask).toHaveBeenCalledWith(null);
    expect(s.setActiveTaskId).toHaveBeenCalledWith(null);
    expect(result.current.undoToast).toBe('Delete Beta');
    expect(result.current.canUndo).toBe(true);
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'ch1');
    expect(result.current.undoToast).toBe(null);
    api.deleteTask.mockResolvedValue({ changeId: 'ch2' });
    await act(async () => { result.current.redo(); });
    await flush();
    expect(api.deleteTask).toHaveBeenLastCalledWith('s1', 'b');
  });

  it('createBaselineMutation names the baseline by date and refreshes only this schedule\'s baselines', async () => {
    const { result } = setup();
    await act(async () => { await result.current.createBaselineMutation.mutateAsync(); });
    expect(api.createBaseline).toHaveBeenCalledWith('s1', `Baseline ${new Date().toLocaleDateString()}`);
    expect(invalidated).toEqual([['baselines', 's1']]);
  });

  it('a Kanban status change is a plain update (no undo)', async () => {
    const { result } = setup();
    act(() => { result.current.handleKanbanStatusChange('c', 'done'); });
    await flush();
    expect(api.updateTask).toHaveBeenCalledWith('s1', 'c', { status: 'done' });
    expect(result.current.canUndo).toBe(false);
  });
});

describe('edits with undo', () => {
  it('updateTaskWithUndo patches the cache at once, saves, and Undo writes the old values back (undefined → null)', async () => {
    const { result } = setup();
    act(() => { result.current.updateTaskWithUndo('b', { name: 'Beta 2', priority: 'high' }); });
    expect(cached().find(t => t.id === 'b')).toMatchObject({ name: 'Beta 2', priority: 'high' });
    await flush();
    expect(api.updateTask).toHaveBeenCalledWith('s1', 'b', { name: 'Beta 2', priority: 'high' });
    expect(result.current.undoDescription).toBe('Edit Beta (name, priority)');
    expect(result.current.undoToast).toBe('Edit Beta (name, priority)');
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.updateTask).toHaveBeenLastCalledWith('s1', 'b', { name: 'Beta', priority: null });
  });

  it('an unknown task id is saved without undo', async () => {
    const { result } = setup();
    act(() => { result.current.updateTaskWithUndo('zz', { name: 'X' }); });
    await flush();
    expect(api.updateTask).toHaveBeenCalledWith('s1', 'zz', { name: 'X' });
    expect(result.current.canUndo).toBe(false);
  });

  it('a new predecessor that moved tasks: the toast says so, Undo restores the moved dates', async () => {
    api.updateTask.mockResolvedValue({ rescheduled: [{ taskId: 'c', oldStart: '2026-03-16', oldEnd: '2026-03-20', newStart: '2026-03-23', newEnd: '2026-03-27' }] });
    const { result } = setup();
    act(() => { result.current.updateTaskWithUndo('c', { dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] }); });
    await flush();
    expect(result.current.undoToast).toBe('Edit Gamma (predecessors) · 1 task moved later');
    expect(result.current.undoDescription).toBe('Edit Gamma (dependencies)');
    invalidated = [];
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.updateTask).toHaveBeenLastCalledWith('s1', 'c', { dependencies: null });
    expect(api.restoreTaskDates).toHaveBeenCalledWith('s1', [{ taskId: 'c', startDate: '2026-03-16', endDate: '2026-03-20' }]);
    expect(invalidated).toEqual([['tasks', 's1'], ['tasks', 's1']]);
  });

  it('a new assignee who would be over 100% gets a warning', async () => {
    api.checkResourceLoad.mockResolvedValue({ resourceId: 'r2', resourceName: 'Sam Builder', overWeeks: [{ weekStart: '2026-03-09', utilization: 140, alsoOn: ['Other'] }] });
    const { result } = setup();
    act(() => { result.current.updateTaskWithUndo('b', { assignedTo: 'r2' }); });
    await flush();
    expect(api.checkResourceLoad).toHaveBeenCalledWith({ resourceId: 'r2', startDate: '2026-03-09', endDate: '2026-03-13', allocationPct: 100, excludeTaskId: 'b' });
    expect(result.current.loadWarning).toMatch(/^Sam would be at 140% in the week of .* \(also on: Other\)\.$/);
  });

  it('the same assignee again, or a summary task, is not checked', async () => {
    const { result } = setup();
    act(() => { result.current.updateTaskWithUndo('a', { assignedTo: 'r1' }); });
    await flush();
    expect(api.checkResourceLoad).not.toHaveBeenCalled();
  });

  it('bar drag: dates patched in the cache, saved, Undo puts the old dates back', async () => {
    const { result } = setup();
    act(() => { result.current.handleTaskDragEndWithUndo('a', '2026-03-03', '2026-03-09'); });
    expect(cached().find(t => t.id === 'a')).toMatchObject({ startDate: '2026-03-03', endDate: '2026-03-09' });
    await flush();
    expect(api.updateTask).toHaveBeenCalledWith('s1', 'a', { startDate: '2026-03-03', endDate: '2026-03-09' });
    expect(result.current.undoToast).toBe('Move Alpha');
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.updateTask).toHaveBeenLastCalledWith('s1', 'a', { startDate: '2026-03-02', endDate: '2026-03-06' });
  });

  it('reorder: bulk update with parent only where it changed; Undo sends the old order', async () => {
    const { result } = setup();
    act(() => { result.current.handleTaskReorder([{ taskId: 'a', sortOrder: 25 }, { taskId: 'b', sortOrder: 5, parentTaskId: null }]); });
    await flush();
    expect(api.bulkUpdateTasks).toHaveBeenCalledWith([
      { id: 'a', scheduleId: 's1', sortOrder: 25 },
      { id: 'b', scheduleId: 's1', sortOrder: 5, parentTaskId: null },
    ]);
    expect(invalidated).toEqual([['tasks', 's1']]);
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.bulkUpdateTasks).toHaveBeenLastCalledWith([
      { id: 'a', scheduleId: 's1', sortOrder: 10 },
      { id: 'b', scheduleId: 's1', sortOrder: 20, parentTaskId: 'p' },
    ]);
  });

  it('bulk update: an empty parent becomes null; Undo sends each old value', async () => {
    const { result } = setup();
    await act(async () => { await result.current.handleBulkUpdate(['a', 'b'], 'parentTaskId', ''); });
    expect(api.bulkUpdateTasks).toHaveBeenCalledWith([{ id: 'a', scheduleId: 's1', parentTaskId: null }, { id: 'b', scheduleId: 's1', parentTaskId: null }]);
    expect(result.current.undoDescription).toBe('Bulk update parentTaskId on 2 tasks');
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.bulkUpdateTasks).toHaveBeenLastCalledWith([{ id: 'a', scheduleId: 's1', parentTaskId: null }, { id: 'b', scheduleId: 's1', parentTaskId: 'p' }]);
    expect(invalidated).toEqual([['tasks', 's1'], ['tasks', 's1']]);
  });

  it('bulk link: chain by row number; Undo unlinks and restores moved dates; errors are the same', async () => {
    api.bulkLinkTasks.mockResolvedValue({ added: [{ taskId: 'b', dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }], moved: [{ taskId: 'b', oldStart: '2026-03-09', oldEnd: '2026-03-13' }] });
    const { result } = setup();
    expect(result.current.rowNumbers.get('a')).toBe(1);
    let msg = '';
    await act(async () => { msg = await result.current.handleBulkLink('chain', ['a', 'b']); });
    expect(api.bulkLinkTasks).toHaveBeenCalledWith('s1', [{ taskId: 'b', dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }]);
    expect(msg).toBe('Linked rows 1 → 2 in order · 1 task moved later');
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.bulkUnlinkTasks).toHaveBeenCalledWith('s1', [{ taskId: 'b', dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }]);
    expect(api.restoreTaskDates).toHaveBeenCalledWith('s1', [{ taskId: 'b', startDate: '2026-03-09', endDate: '2026-03-13' }]);
    api.bulkLinkTasks.mockResolvedValue({ added: [], moved: [] });
    await expect(result.current.handleBulkLink('chain', ['a', 'b'])).rejects.toThrow('Those tasks are already linked — nothing was added');
    api.bulkLinkTasks.mockRejectedValue({ response: { data: { message: 'Loop' } } });
    await expect(result.current.handleBulkLink('chain', ['a', 'b'])).rejects.toThrow('Loop');
    api.bulkLinkTasks.mockRejectedValue(new Error('net'));
    await expect(result.current.handleBulkLink('chain', ['a', 'b'])).rejects.toThrow('Linking failed. Nothing was changed.');
  });

  it('group: Undo goes through Schedule History', async () => {
    api.groupTasks.mockResolvedValue({ grouped: 2, changeId: 'g1' });
    const { result } = setup();
    let msg = '';
    await act(async () => { msg = await result.current.handleGroupTasks(['a', 'c'], 'Phase'); });
    expect(api.groupTasks).toHaveBeenCalledWith('s1', ['a', 'c'], 'Phase');
    expect(msg).toBe("Grouped 2 tasks under 'Phase'");
    expect(invalidated).toEqual([['tasks', 's1']]);
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'g1');
    api.groupTasks.mockRejectedValue(new Error('x'));
    await expect(result.current.handleGroupTasks(['a'], 'P')).rejects.toThrow('Grouping failed. Nothing was changed.');
  });

  it('bulk delete: invalidates tasks + schedule-changes; Undo goes through Schedule History', async () => {
    api.bulkDeleteTasks.mockResolvedValue({ changeId: 'd1' });
    const { result } = setup();
    await act(async () => { await result.current.handleBulkDelete(['a', 'c']); });
    expect(api.bulkDeleteTasks).toHaveBeenCalledWith('s1', ['a', 'c']);
    expect(invalidated).toEqual([['tasks', 's1'], ['schedule-changes', 's1']]);
    expect(result.current.undoDescription).toBe('Delete 2 tasks');
    await act(async () => { result.current.undo(); });
    await flush();
    expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'd1');
  });

  it('duplicate: one create per task, in order, named "(copy)"', async () => {
    const { result } = setup();
    await act(async () => { await result.current.handleDuplicateTasks([TASKS[0], TASKS[1]]); });
    expect(api.createTask.mock.calls.map(c => (c[1] as { name: string }).name)).toEqual(['Alpha (copy)', 'Beta (copy)']);
    expect(api.createTask.mock.calls[1][1]).toMatchObject({ status: 'in_progress', priority: 'medium', parentTaskId: 'p', startDate: '2026-03-09' });
  });

  it('the Undo toast clears itself after 4 s', async () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => { result.current.handleTaskDragEndWithUndo('a', '2026-03-03', '2026-03-09'); });
      expect(result.current.undoToast).toBe('Move Alpha');
      act(() => { vi.advanceTimersByTime(3999); });
      expect(result.current.undoToast).toBe('Move Alpha');
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.undoToast).toBe(null);
    } finally { vi.useRealTimers(); }
  });
});

