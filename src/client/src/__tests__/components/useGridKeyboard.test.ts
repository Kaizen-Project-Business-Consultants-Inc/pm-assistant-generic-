/**
 * useGridKeyboard — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * Drives the real document keydown listener: arrows move the focused cell within bounds,
 * Enter/F2/Escape, cell and row copy/paste with the same update payloads as before (duration
 * and predecessors through the same planners as typing), Ctrl+D, Tab/Shift+Tab indent/outdent,
 * Alt+Up/Down reorder, and nothing while a cell is being edited or keys go to an input.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridKeyboard } from '../../components/schedule/gantt/hooks/useGridKeyboard';
import { buildFlatRows, GANTT_COLUMNS, type GanttTask, type EditableField, type GanttColDef } from '../../components/schedule/gantt/types';
import { planDurationEdit } from '../../components/schedule/durationEdit';
import { planPredecessorEdit } from '../../components/schedule/predecessorEdit';
import { workingDaysBetween } from '../../utils/workingDays';

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'A', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20, progressPercentage: 40, estimatedDays: 3 },
  { id: 'b', name: 'B', status: 'in_progress', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30, dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] },
  { id: 'c', name: 'C', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 40 },
];

/** Stand-in for GanttChart's getTaskFieldValue (it is passed in; the hook only copies what it returns) */
const getTaskFieldValue = (task: GanttTask, field: EditableField): string => {
  if (field === 'duration') return String(workingDaysBetween(task.startDate, task.endDate));
  if (field === 'dependency') return task.id === 'b' ? '2' : '';
  if (field === 'progressPercentage') return String(task.progressPercentage ?? 0);
  const v = (task as unknown as Record<string, unknown>)[field];
  return v == null ? '' : String(v);
};

type Props = Parameters<typeof useGridKeyboard>[0];

function setup(over: Partial<Props> = {}) {
  const tasks = over.tasks ?? TASKS;
  const rows = over.rows ?? buildFlatRows(tasks);
  const rowNumToTaskId = new Map<number, string>(rows.map((r, i) => [i + 1, r.task.id]));
  const props: Props = {
    tasks,
    rows,
    editingCell: null,
    activeTaskId: null,
    onTaskUpdate: vi.fn(),
    onTaskReorder: vi.fn(),
    onTaskSelect: vi.fn(),
    onDuplicateTasks: vi.fn(),
    onBulkUpdate: vi.fn(async () => {}),
    startEditing: vi.fn(),
    getTaskFieldValue,
    rowNumToTaskId,
    workCalendar: null,
    someSelected: (over.selectedIds?.size ?? 0) > 0,
    selectedIds: new Set(),
    setBulkMessage: vi.fn(),
    orderedColumns: GANTT_COLUMNS,
    isColVisible: () => true,
    ...over,
  };
  const hook = renderHook((p: Props) => useGridKeyboard(p), { initialProps: props });
  return { ...hook, props, rows };
}

function key(k: string, opts: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => { target.dispatchEvent(e); });
  return e;
}

const byId = (id: string) => TASKS.find(t => t.id === id)!;

/** Focus a cell the way a user does: select a row, Enter (first visible field), then arrows */
function focusCell(s: ReturnType<typeof setup>, taskId: string, field: EditableField) {
  if (s.result.current.focusedCell) key('Escape');
  s.rerender({ ...s.props, activeTaskId: taskId });
  key('Enter');
  const order = visibleOrder(s.props.orderedColumns, s.props.isColVisible);
  for (let i = 0; i < order.indexOf(field); i++) key('ArrowRight');
  expect(s.result.current.focusedCell).toEqual({ taskId, field });
}

const COL_TO_FIELD: Record<string, EditableField> = {
  name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
  dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
  priority: 'priority', assigned: 'assignedTo', status: 'status',
};
const visibleOrder = (cols: GanttColDef[], vis: (c: GanttColDef) => boolean) =>
  cols.filter(c => vis(c) && COL_TO_FIELD[c.key]).map(c => COL_TO_FIELD[c.key]);

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('useGridKeyboard — focused cell and arrow keys', () => {
  it('Enter on the selected row focuses its first visible field', () => {
    const s = setup({ activeTaskId: 'a' });
    expect(s.result.current.focusedCell).toBeNull();
    const e = key('Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(s.result.current.focusedCell).toEqual({ taskId: 'a', field: visibleOrder(GANTT_COLUMNS, () => true)[0] });
  });

  it('arrows move within the visible columns and rows, and stop at the edges', () => {
    const s = setup();
    const order = visibleOrder(GANTT_COLUMNS, () => true);
    focusCell(s, 'p', order[0]);
    key('ArrowLeft');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'p', field: order[0] }); // left edge
    key('ArrowUp');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'p', field: order[0] }); // top edge
    expect(s.props.onTaskSelect).not.toHaveBeenCalled();
    key('ArrowRight');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'p', field: order[1] });
    for (let i = 0; i < order.length + 3; i++) key('ArrowRight');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'p', field: order[order.length - 1] }); // right edge
    key('ArrowDown');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'a', field: order[order.length - 1] });
    expect(s.props.onTaskSelect).toHaveBeenLastCalledWith(byId('a'));
    for (let i = 0; i < 10; i++) key('ArrowDown');
    expect(s.result.current.focusedCell?.taskId).toBe('c'); // bottom edge
    key('ArrowUp');
    expect(s.result.current.focusedCell?.taskId).toBe('b');
    expect(s.props.onTaskSelect).toHaveBeenLastCalledWith(byId('b'));
  });

  it('hidden columns are skipped', () => {
    const visible = new Set(['name', 'end']);
    const s = setup({ isColVisible: (c: GanttColDef) => visible.has(c.key) });
    focusCell(s, 'a', 'name');
    key('ArrowRight');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'a', field: 'endDate' });
    key('ArrowRight');
    expect(s.result.current.focusedCell).toEqual({ taskId: 'a', field: 'endDate' });
  });

  it('Enter and F2 start editing the focused cell; Escape leaves it', () => {
    const s = setup();
    focusCell(s, 'b', 'name');
    key('F2');
    expect(s.props.startEditing).toHaveBeenLastCalledWith('b', 'name', byId('b'));
    key('Enter');
    expect(s.props.startEditing).toHaveBeenCalledTimes(2);
    key('Escape');
    expect(s.result.current.focusedCell).toBeNull();
  });

  it('when an inline edit ends, the focus goes back to that cell', () => {
    const s = setup();
    s.rerender({ ...s.props, editingCell: { taskId: 'c', field: 'endDate' } });
    expect(s.result.current.focusedCell).toBeNull();
    s.rerender({ ...s.props, editingCell: null });
    expect(s.result.current.focusedCell).toEqual({ taskId: 'c', field: 'endDate' });
  });
});

describe('useGridKeyboard — copy / paste', () => {
  it('cell copy puts the value on the clipboard; paste into the same column saves it and flashes', () => {
    vi.useFakeTimers();
    const s = setup();
    focusCell(s, 'a', 'name');
    key('c', { ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith('A');
    key('ArrowDown');
    const e = key('v', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(s.props.onTaskUpdate).toHaveBeenCalledWith('b', { name: 'A' });
    expect(s.result.current.pasteFlash).toEqual({ taskId: 'b', field: 'name' });
    act(() => { vi.advanceTimersByTime(800); });
    expect(s.result.current.pasteFlash).toBeNull();
  });

  it('pasted % complete is clamped to 0–100 and estimates to ≥ 0, as numbers', () => {
    const tasks = TASKS.map(t => (t.id === 'a' ? { ...t, progressPercentage: 140, estimatedDays: -2 } : t));
    const s = setup({ tasks });
    focusCell(s, 'a', 'progressPercentage');
    key('c', { ctrlKey: true });
    key('ArrowDown');
    key('v', { ctrlKey: true });
    expect(s.props.onTaskUpdate).toHaveBeenLastCalledWith('b', { progressPercentage: 100 });
    focusCell(s, 'a', 'estimatedDays');
    key('c', { metaKey: true });
    key('ArrowDown');
    key('v', { metaKey: true });
    expect(s.props.onTaskUpdate).toHaveBeenLastCalledWith('b', { estimatedDays: 0 });
  });

  it('a pasted duration moves the finish the same way typing it does', () => {
    const s = setup();
    focusCell(s, 'a', 'duration');
    key('c', { ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith('5');
    key('ArrowDown');
    key('ArrowDown'); // c
    key('v', { ctrlKey: true });
    const plan = planDurationEdit(byId('c'), '5', null);
    expect(plan.ok).toBe(true);
    expect(s.props.onTaskUpdate).toHaveBeenCalledWith('c', (plan as { patch: Record<string, unknown> }).patch);
  });

  it('pasted predecessors go through the same parser as typing them', () => {
    const s = setup();
    focusCell(s, 'b', 'dependency');
    key('c', { ctrlKey: true });
    key('ArrowDown');
    key('v', { ctrlKey: true });
    const plan = planPredecessorEdit('2', 'c', s.props.rowNumToTaskId);
    expect(plan.ok).toBe(true);
    expect(s.props.onTaskUpdate).toHaveBeenCalledWith('c', (plan as { patch: Record<string, unknown> }).patch);
  });

  it('paste into a different column, or a summary\'s rolled-up cell, does nothing', () => {
    const s = setup();
    focusCell(s, 'a', 'status');
    key('c', { ctrlKey: true });
    key('ArrowUp'); // the summary row p
    key('v', { ctrlKey: true });
    focusCell(s, 'b', 'name');
    key('v', { ctrlKey: true }); // copied a status, not a name
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
  });

  it('row copy (no focused cell) copies the selected row; paste duplicates it', () => {
    const s = setup({ activeTaskId: 'b' });
    key('c', { ctrlKey: true });
    expect(s.props.setBulkMessage).toHaveBeenCalledWith('Copied 1 task');
    key('v', { ctrlKey: true });
    expect(s.props.onDuplicateTasks).toHaveBeenCalledWith([byId('b')]);
  });

  it('row copy with several selected copies them in row order', () => {
    const s = setup({ selectedIds: new Set(['c', 'a']), activeTaskId: 'b' });
    key('c', { ctrlKey: true });
    expect(s.props.setBulkMessage).toHaveBeenCalledWith('Copied 2 tasks');
    key('v', { ctrlKey: true });
    expect(s.props.onDuplicateTasks).toHaveBeenCalledWith([byId('a'), byId('c')]);
  });

  it('Ctrl+D duplicates the selected row', () => {
    const s = setup({ activeTaskId: 'c' });
    key('d', { ctrlKey: true });
    expect(s.props.onDuplicateTasks).toHaveBeenCalledWith([byId('c')]);
  });
});

describe('useGridKeyboard — indent / outdent / reorder', () => {
  it('Tab indents the active task under the row above; Shift+Tab outdents to its grandparent', () => {
    const s = setup({ activeTaskId: 'c' });
    const e = key('Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(s.props.onTaskUpdate).toHaveBeenLastCalledWith('c', { parentTaskId: 'b' });
    s.rerender({ ...s.props, activeTaskId: 'a' });
    key('Tab', { shiftKey: true });
    expect(s.props.onTaskUpdate).toHaveBeenLastCalledWith('a', { parentTaskId: null });
  });

  it('Tab on a task already under the row above, or Shift+Tab on a top-level task, does nothing', () => {
    const s = setup({ activeTaskId: 'a' });
    key('Tab'); // a is already under p
    s.rerender({ ...s.props, activeTaskId: 'c' });
    key('Tab', { shiftKey: true });
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
  });

  it('several selected: indent and outdent through the bulk update', () => {
    const s = setup({ selectedIds: new Set(['b', 'c']) });
    key('Tab');
    expect(s.props.onBulkUpdate).toHaveBeenLastCalledWith(['b', 'c'], 'parentTaskId', 'a');
    key('Tab', { shiftKey: true });
    expect(s.props.onBulkUpdate).toHaveBeenLastCalledWith(['b'], 'parentTaskId', '');
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
  });

  it('Tab still indents when the focus is on a row checkbox', () => {
    const s = setup({ activeTaskId: 'c' });
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    key('Tab', {}, box);
    expect(s.props.onTaskUpdate).toHaveBeenCalledWith('c', { parentTaskId: 'b' });
    box.remove();
  });

  it('Alt+Down moves the active row one place down (sort orders 10, 20, …)', () => {
    const s = setup({ activeTaskId: 'a' });
    key('ArrowDown', { altKey: true });
    expect(s.props.onTaskReorder).toHaveBeenCalledWith([
      { taskId: 'p', sortOrder: 10 }, { taskId: 'b', sortOrder: 20 }, { taskId: 'a', sortOrder: 30 }, { taskId: 'c', sortOrder: 40 },
    ]);
    s.rerender({ ...s.props, activeTaskId: 'p' });
    key('ArrowUp', { altKey: true }); // already first
    expect(s.props.onTaskReorder).toHaveBeenCalledTimes(1);
  });
});

describe('useGridKeyboard — when it stays out of the way', () => {
  it('keys typed in an input, textarea or select are ignored', () => {
    const s = setup({ activeTaskId: 'c' });
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      key('Tab', {}, el);
      key('Enter', {}, el);
      key('c', { ctrlKey: true }, el);
      key('d', { ctrlKey: true }, el);
      el.remove();
    }
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
    expect(s.props.onDuplicateTasks).not.toHaveBeenCalled();
    expect(s.props.setBulkMessage).not.toHaveBeenCalled();
    expect(s.result.current.focusedCell).toBeNull();
  });

  it('nothing fires while a cell is being edited', () => {
    const s = setup({ activeTaskId: 'c', editingCell: { taskId: 'c', field: 'name' } });
    key('Tab');
    key('Enter');
    key('ArrowDown', { altKey: true });
    key('d', { ctrlKey: true });
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
    expect(s.props.onTaskReorder).not.toHaveBeenCalled();
    expect(s.props.onDuplicateTasks).not.toHaveBeenCalled();
    expect(s.result.current.focusedCell).toBeNull();
  });

  it('read-only plan (no onTaskUpdate): no keyboard handling at all', () => {
    const s = setup({ activeTaskId: 'c', onTaskUpdate: undefined });
    key('Tab');
    key('Enter');
    key('d', { ctrlKey: true });
    key('ArrowDown', { altKey: true });
    expect(s.props.onDuplicateTasks).not.toHaveBeenCalled();
    expect(s.props.onTaskReorder).not.toHaveBeenCalled();
    expect(s.result.current.focusedCell).toBeNull();
  });

  it('the listener is removed on unmount', () => {
    const s = setup({ activeTaskId: 'c' });
    s.unmount();
    key('Tab');
    key('d', { ctrlKey: true });
    expect(s.props.onTaskUpdate).not.toHaveBeenCalled();
    expect(s.props.onDuplicateTasks).not.toHaveBeenCalled();
  });
});
