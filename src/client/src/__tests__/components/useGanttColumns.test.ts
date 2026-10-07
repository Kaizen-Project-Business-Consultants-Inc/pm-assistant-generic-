/**
 * useGanttColumns — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * Pins the localStorage keys and value formats exactly as GanttChart wrote them before the
 * move, so users' saved column layouts survive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGanttColumns, useGanttColumnAutoFit } from '../../components/schedule/gantt/hooks/useGanttColumns';
import { GANTT_COLUMNS, type FlatRow, type GanttTask } from '../../components/schedule/gantt/types';
import type { ColumnState } from '../../hooks/useColumnState';

const DEFAULT_ORDER = ['rowNum', 'name', 'dur', 'start', 'end', 'pred', 'assigned', 'status', 'succ', 'est', 'work', 'pct', 'priority', 'resource', 'notes', 'editIcon'];
const col = (key: string) => GANTT_COLUMNS.find(c => c.key === key)!;
const keysOf = (cols: { key: string }[]) => cols.map(c => c.key);

beforeEach(() => localStorage.clear());

describe('useGanttColumns — persistence (same keys and formats as before the move)', () => {
  it('writes the defaults under gantt-visible-cols:<id> and gantt-col-order:<id>, and no widths until one is set', () => {
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));
    expect(JSON.parse(localStorage.getItem('gantt-visible-cols:s1')!)).toEqual(['dur', 'start', 'end', 'pred', 'assigned', 'status']);
    expect(JSON.parse(localStorage.getItem('gantt-col-order:s1')!)).toEqual(DEFAULT_ORDER);
    expect(localStorage.getItem('gantt-col-widths:s1')).toBeNull();
    expect(keysOf(result.current.orderedColumns)).toEqual(DEFAULT_ORDER);
  });

  it('restores a saved layout, keeping saved order, dropping unknown keys and appending new columns', () => {
    localStorage.setItem('gantt-visible-cols:s1', JSON.stringify(['pct', 'notes']));
    localStorage.setItem('gantt-col-order:s1', JSON.stringify(['rowNum', 'name', 'pct', 'gone', 'status', 'dur']));
    localStorage.setItem('gantt-col-widths:s1', JSON.stringify({ pct: 99, rowNum: 500 }));
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));

    const expectedOrder = ['rowNum', 'name', 'pct', 'status', 'dur', 'start', 'end', 'pred', 'assigned', 'succ', 'est', 'work', 'priority', 'resource', 'notes', 'editIcon'];
    expect(keysOf(result.current.orderedColumns)).toEqual(expectedOrder);
    expect([...result.current.ganttVisibleCols]).toEqual(['pct', 'notes']);
    expect(result.current.isColVisible(col('pct'))).toBe(true);
    expect(result.current.isColVisible(col('dur'))).toBe(false);
    expect(result.current.isColVisible(col('name'))).toBe(true); // always visible
    expect(result.current.getColWidth(col('pct'))).toBe(99);
    expect(result.current.getColWidth(col('rowNum'))).toBe(40); // fixed columns ignore saved widths
    // rowNum 40 + name 250 + pct 99 + notes 120 + editIcon 72
    expect(result.current.minRowWidth).toBe(40 + 250 + 99 + 120 + 72);
    // Round trip: what was read is written back in the same format
    expect(JSON.parse(localStorage.getItem('gantt-col-order:s1')!)).toEqual(expectedOrder);
    expect(JSON.parse(localStorage.getItem('gantt-col-widths:s1')!)).toEqual({ pct: 99, rowNum: 500 });
  });

  it('falls back to defaults on corrupt saved values', () => {
    localStorage.setItem('gantt-visible-cols:s1', '{not json');
    localStorage.setItem('gantt-col-order:s1', '{not json');
    localStorage.setItem('gantt-col-widths:s1', '{not json');
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));
    expect(keysOf(result.current.orderedColumns)).toEqual(DEFAULT_ORDER);
    expect([...result.current.ganttVisibleCols]).toEqual(['dur', 'start', 'end', 'pred', 'assigned', 'status']);
    expect(result.current.getColWidth(col('pct'))).toBe(48);
  });

  it('without a scheduleId nothing is read or written', () => {
    localStorage.setItem('gantt-visible-cols:undefined', JSON.stringify(['pct']));
    const { result } = renderHook(() => useGanttColumns({}));
    act(() => result.current.toggleColVisibility('pct'));
    expect(localStorage.length).toBe(1);
    expect(result.current.ganttVisibleCols.has('pct')).toBe(true);
  });
});

describe('useGanttColumns — hide/show, reorder, resize', () => {
  it('toggleColVisibility hides and shows, and persists', () => {
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));
    act(() => result.current.toggleColVisibility('dur'));
    expect(result.current.isColVisible(col('dur'))).toBe(false);
    expect(JSON.parse(localStorage.getItem('gantt-visible-cols:s1')!)).toEqual(['start', 'end', 'pred', 'assigned', 'status']);
    act(() => result.current.toggleColVisibility('dur'));
    expect(JSON.parse(localStorage.getItem('gantt-visible-cols:s1')!)).toEqual(['start', 'end', 'pred', 'assigned', 'status', 'dur']);
  });

  it('moveColumn swaps neighbours, never with pinned columns, and persists', () => {
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));
    act(() => result.current.moveColumn('start', 'left'));
    expect(keysOf(result.current.orderedColumns).slice(0, 5)).toEqual(['rowNum', 'name', 'start', 'dur', 'end']);
    expect(JSON.parse(localStorage.getItem('gantt-col-order:s1')!).slice(0, 5)).toEqual(['rowNum', 'name', 'start', 'dur', 'end']);
    act(() => result.current.moveColumn('start', 'left')); // would swap with name (pinned)
    expect(keysOf(result.current.orderedColumns).slice(0, 3)).toEqual(['rowNum', 'name', 'start']);
    act(() => result.current.moveColumn('notes', 'right')); // would swap with editIcon (pinned)
    expect(keysOf(result.current.orderedColumns).slice(-2)).toEqual(['notes', 'editIcon']);
    act(() => result.current.moveColumn('nope', 'right'));
    expect(keysOf(result.current.orderedColumns).length).toBe(16);
  });

  it('dragging a column edge resizes it (respecting min width) and persists', () => {
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1' }));
    const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 100 } as unknown as React.MouseEvent;
    act(() => result.current.handleColResizeStart(ev, 'pct', 48));
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 130 })); });
    expect(result.current.getColWidth(col('pct'))).toBe(78);
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 })); });
    expect(result.current.getColWidth(col('pct'))).toBe(36); // minWidth
    act(() => { document.dispatchEvent(new MouseEvent('mouseup')); });
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })); });
    expect(result.current.getColWidth(col('pct'))).toBe(36); // listener removed on mouseup
    expect(JSON.parse(localStorage.getItem('gantt-col-widths:s1')!)).toEqual({ pct: 36 });
  });
});

describe('useGanttColumns — external columnState (Table keys)', () => {
  const external = (visible: string[], order: string[]) => ({
    visibleKeys: new Set(visible),
    columnOrder: order,
    setColumnOrder: vi.fn(),
  }) as unknown as ColumnState;

  it('uses the Table view visibility and order, mapped to Gantt keys', () => {
    const cs = external(['progressPercentage', 'startDate'], ['rowNum', 'progressPercentage', 'startDate', 'unknownCol']);
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs }));
    expect(result.current.isColVisible(col('pct'))).toBe(true);
    expect(result.current.isColVisible(col('start'))).toBe(true);
    expect(result.current.isColVisible(col('dur'))).toBe(false); // own default says visible, Table says not
    expect(result.current.isColVisible(col('resource'))).toBe(false); // Table says hidden
    expect(keysOf(result.current.orderedColumns)).toEqual(
      ['rowNum', 'name', 'pct', 'start', 'pred', 'succ', 'end', 'dur', 'est', 'work', 'priority', 'assigned', 'resource', 'status', 'notes', 'editIcon'],
    );
    expect(result.current.ganttKeyToTableKey.pct).toBe('progressPercentage');
  });

  it('Resource and Notes follow the Table\'s saved visibility and order (both were ignored before 2026-10-06)', () => {
    // The Gantt's own state says Resource is visible — the shared (Table) state wins
    localStorage.setItem('gantt-visible-cols:s1', JSON.stringify(['resource']));
    const cs = external(['notes', 'status'], ['rowNum', 'notes', 'status', 'resource']);
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs }));
    expect(result.current.isColVisible(col('notes'))).toBe(true);
    expect(result.current.isColVisible(col('resource'))).toBe(false);
    expect(keysOf(result.current.orderedColumns).slice(0, 5)).toEqual(['rowNum', 'name', 'notes', 'status', 'resource']);

    const cs2 = external(['resource'], ['rowNum', 'resource', 'notes']);
    const { result: r2 } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs2 }));
    expect(r2.current.isColVisible(col('resource'))).toBe(true);
    expect(keysOf(r2.current.orderedColumns).slice(0, 4)).toEqual(['rowNum', 'name', 'resource', 'notes']);
  });

  it('Est and Work follow the Table\'s Est Days / Work visibility and order, whatever the Gantt\'s own state says (2026-10-06)', () => {
    localStorage.setItem('gantt-visible-cols:s1', JSON.stringify(['est', 'work']));
    const cs = external(['status'], []);
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs }));
    expect(result.current.isColVisible(col('est'))).toBe(false);
    expect(result.current.isColVisible(col('work'))).toBe(false);

    // Switched on in the shared picker (the Table's Est Days / Work), in the Table's saved order
    const cs2 = external(['estimatedDurationHours', 'estimatedDays', 'status'], ['rowNum', 'estimatedDurationHours', 'status', 'estimatedDays']);
    const { result: r2 } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs2 }));
    expect(r2.current.isColVisible(col('est'))).toBe(true);
    expect(r2.current.isColVisible(col('work'))).toBe(true);
    expect(keysOf(r2.current.orderedColumns).slice(0, 5)).toEqual(['rowNum', 'name', 'work', 'status', 'est']);
    expect(r2.current.ganttKeyToTableKey.est).toBe('estimatedDays');
    expect(r2.current.ganttKeyToTableKey.work).toBe('estimatedDurationHours');
  });

  it('dragging columns into a new order in the Gantt writes Table keys and keeps Table-only columns in place', () => {
    const order = ['rowNum', 'name', 'earlyStart', 'status', 'notes', 'wbs', 'resource'];
    const cs = external(['status', 'notes', 'resource'], order);
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs }));
    expect(keysOf(result.current.orderedColumns).slice(0, 5)).toEqual(['rowNum', 'name', 'status', 'notes', 'resource']);
    // Drag Resource onto Status
    const dt = { effectAllowed: '', dropEffect: '', setData: () => {} };
    act(() => {
      result.current.ganttColDrag.handleDragStart({ dataTransfer: dt } as unknown as React.DragEvent, 'resource');
    });
    act(() => {
      result.current.ganttColDrag.handleDragOver({ dataTransfer: dt, preventDefault: () => {} } as unknown as React.DragEvent, 'status');
    });
    act(() => {
      result.current.ganttColDrag.handleDrop({ preventDefault: () => {} } as unknown as React.DragEvent, 'status');
    });
    const setOrder = cs.setColumnOrder as unknown as ReturnType<typeof vi.fn>;
    expect(setOrder).toHaveBeenCalledTimes(1);
    const next = (setOrder.mock.calls[0][0] as (p: string[]) => string[])(order);
    // Only the shared columns' slots changed; earlyStart and wbs stayed put; no Gantt keys leak in
    expect(next.slice(0, 7)).toEqual(['rowNum', 'name', 'earlyStart', 'resource', 'status', 'wbs', 'notes']);
    expect(next).not.toContain('est');
    expect(next).not.toContain('work');
    // Est Days / Work are Table columns now: present once each, under their Table keys
    expect(next.filter(k => k === 'estimatedDays')).toHaveLength(1);
    expect(next.filter(k => k === 'estimatedDurationHours')).toHaveLength(1);
    expect(new Set(next).size).toBe(next.length);
  });

  it('an empty external order falls back to the Gantt\'s own saved order', () => {
    const cs = external([], []);
    const { result } = renderHook(() => useGanttColumns({ scheduleId: 's1', columnState: cs }));
    expect(keysOf(result.current.orderedColumns)).toEqual(DEFAULT_ORDER);
  });
});

describe('useGanttColumnAutoFit', () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: (t: string) => ({ width: t.length * 6 }) })) as any;
  });
  afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

  const row = (t: Partial<GanttTask>): FlatRow => ({ task: { id: 'x', name: '', status: 'pending', ...t } as GanttTask, level: 0, wbs: '1' });

  it('sets the column to widest text + 24, clamped to min width and 400', () => {
    const setW = vi.fn();
    const rows = [row({ assignedTo: 'Al' }), row({ assignedTo: 'A much longer person name' })];
    const { result } = renderHook(() => useGanttColumnAutoFit({ rows, getTaskFieldValue: () => '', workCalendar: null, setGanttColWidths: setW }));
    act(() => result.current('assigned'));
    const update = setW.mock.calls[0][0] as (p: Record<string, number>) => Record<string, number>;
    expect(update({ pct: 50 })).toEqual({ pct: 50, assigned: Math.ceil(25 * 6 + 24) });

    setW.mockClear();
    act(() => result.current('pct')); // '0%' is narrower than min width
    expect((setW.mock.calls[0][0] as any)({})).toEqual({ pct: 36 });

    setW.mockClear();
    const long = [row({ description: 'x'.repeat(200) })];
    const { result: r2 } = renderHook(() => useGanttColumnAutoFit({ rows: long, getTaskFieldValue: () => '', workCalendar: null, setGanttColWidths: setW }));
    act(() => r2.current('notes'));
    expect((setW.mock.calls[0][0] as any)({})).toEqual({ notes: 400 });
  });

  it('ignores fixed columns and uses the predecessor text for pred', () => {
    const setW = vi.fn();
    const getVal = vi.fn(() => '12FS+3d,14');
    const { result } = renderHook(() => useGanttColumnAutoFit({ rows: [row({})], getTaskFieldValue: getVal, workCalendar: null, setGanttColWidths: setW }));
    act(() => result.current('rowNum'));
    expect(setW).not.toHaveBeenCalled();
    act(() => result.current('pred'));
    expect(getVal).toHaveBeenCalledWith(expect.objectContaining({ id: 'x' }), 'dependency');
    expect((setW.mock.calls[0][0] as any)({})).toEqual({ pred: Math.ceil(10 * 6 + 24) });
  });
});
