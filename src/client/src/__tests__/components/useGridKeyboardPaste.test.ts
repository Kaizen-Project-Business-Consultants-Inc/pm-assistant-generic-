/**
 * shared/hooks/useGridKeyboardPaste — the grid keyboard steps the Gantt grid and the Table view
 * do the same way (2026-10-05, code-health item 4 phase 3).
 *
 * The main check is an equivalence test: the Gantt's useGridKeyboard and the Table's
 * useGridCellState + useTableKeyboard are driven with long scripted key sequences (seeded, so
 * repeatable) next to reference copies of the code they replaced (keyboardReference/*.before.ts,
 * pasted verbatim from f6793313). Every step records preventDefault, the focused cell, the
 * pasted-cell flash, every callback call with its payload, clipboard writes and the timers'
 * effects; the two traces must be identical. Plus a few direct checks of the rules.
 * Since 2026-10-09 (audit K1/K2) a key is the grid's only while the user works in the grid: the
 * driver clicks in a stand-in grid before every key (Escape now leaves the grid) and keeps its
 * inputs inside it; the Table's Tab no longer takes the key when it has nothing to indent, so
 * Tab's preventDefault is left out of the Table comparison (gridFocusScope.test.ts checks it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridKeyboard } from '../../components/schedule/gantt/hooks/useGridKeyboard';
import { useGridKeyboardBefore } from './keyboardReference/ganttGridKeyboard.before';
import { useTableKeyboard } from '../../components/schedule/table/hooks/useTableKeyboard';
import { useTableKeyboardBefore, type TableKeyboardRefProps } from './keyboardReference/tableKeyboard.before';
import {
  useGridCellState, GANTT_KEYBOARD_RULES, TABLE_KEYBOARD_RULES, rowsToCopy, pasteIntoFocusedCell,
} from '../../components/schedule/shared/hooks/useGridKeyboardPaste';
import { buildFlatRows, GANTT_COLUMNS, type GanttTask, type EditableField as GanttField, type GanttColDef } from '../../components/schedule/gantt/types';
import type { EditableField as TableField } from '../../components/schedule/table/types';
import { workingDaysBetween } from '../../utils/workingDays';

// ---------------------------------------------------------------------------------------------
// Plan used by both views: a phase with children, a nested child, a second phase, loose tasks
// ---------------------------------------------------------------------------------------------
const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'A', status: 'pending', priority: 'high', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20, progressPercentage: 40, estimatedDays: 3, description: 'note a' } as GanttTask,
  { id: 'b', name: 'B', status: 'in_progress', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30, progressPercentage: 150, dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] },
  { id: 'b1', name: 'B1', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-10', parentTaskId: 'b', sortOrder: 35, estimatedDays: -2 } as GanttTask,
  { id: 'q', name: 'Phase 2', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-27', sortOrder: 40, isSummary: true },
  { id: 'c', name: 'C', status: 'completed', startDate: '2026-03-16', endDate: '2026-03-20', parentTaskId: 'q', sortOrder: 50, budgetAllocated: '$1,200', description: '' } as unknown as GanttTask,
  { id: 'd', name: 'D', status: 'pending', startDate: '2026-03-23', endDate: '2026-03-27', sortOrder: 60, progressPercentage: 0 },
];
const IDS = TASKS.map(t => t.id);

/** Stand-in for the views' getTaskFieldValue (passed in; the hooks only copy what it returns) */
const getTaskFieldValue = (task: GanttTask, field: string): string => {
  if (field === 'duration') return task.id === 'd' ? 'abc' : String(workingDaysBetween(task.startDate, task.endDate));
  if (field === 'dependency') return task.id === 'b' ? '2' : task.id === 'c' ? '99' : '';
  if (field === 'progressPercentage') return String(task.progressPercentage ?? 0);
  if (field === 'notes') return (task as unknown as { description?: string }).description || '';
  const v = (task as unknown as Record<string, unknown>)[field];
  return v == null ? '' : String(v);
};

// ---------------------------------------------------------------------------------------------
// Scripted driver
// ---------------------------------------------------------------------------------------------
type Trace = unknown[];

/** Small seeded PRNG (mulberry32) so a failing sequence can be replayed */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step =
  | { kind: 'key'; key: string; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean }
  | { kind: 'target'; to: 'body' | 'input' | 'checkbox' | 'select' | 'textarea' }
  | { kind: 'active'; id: string | null }
  | { kind: 'select'; ids: string[] }
  | { kind: 'editing'; on: boolean }
  | { kind: 'contextMenu'; on: boolean }
  | { kind: 'time'; ms: number };

const KEYS: Array<Omit<Extract<Step, { kind: 'key' }>, 'kind'>> = [
  { key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowUp' }, { key: 'ArrowDown' },
  { key: 'ArrowLeft' }, { key: 'ArrowRight' }, { key: 'Enter' }, { key: 'F2' }, { key: 'Escape' },
  { key: 'Tab' }, { key: 'Tab', shift: true }, { key: 'Delete' }, { key: 'x' },
  { key: 'c', ctrl: true }, { key: 'v', ctrl: true }, { key: 'c', ctrl: true }, { key: 'v', ctrl: true },
  { key: 'v', meta: true }, { key: 'd', ctrl: true }, { key: 'ArrowUp', alt: true }, { key: 'ArrowDown', alt: true },
  { key: 'ArrowRight', ctrl: true },
];

function script(seed: number, length: number): Step[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const steps: Step[] = [{ kind: 'active', id: pick(IDS) }, { kind: 'key', key: 'Enter' }];
  for (let i = 0; i < length; i++) {
    const x = r();
    if (x < 0.74) steps.push({ kind: 'key', ...pick(KEYS) });
    else if (x < 0.79) steps.push({ kind: 'target', to: pick(['body', 'body', 'input', 'checkbox', 'select', 'textarea'] as const) });
    else if (x < 0.84) steps.push({ kind: 'active', id: r() < 0.15 ? null : pick(IDS) });
    else if (x < 0.88) steps.push({ kind: 'select', ids: r() < 0.4 ? [] : IDS.filter(() => r() < 0.35) });
    else if (x < 0.92) steps.push({ kind: 'editing', on: r() < 0.5 });
    else if (x < 0.95) steps.push({ kind: 'contextMenu', on: r() < 0.5 });
    else steps.push({ kind: 'time', ms: pick([300, 900, 2100, 3100]) });
  }
  return steps;
}

/** A stand-in for the task grid; the driver's inputs live in it, and it is clicked before each key */
const grid = document.createElement('div');
grid.setAttribute('role', 'grid');
document.body.appendChild(grid);

const targets: Record<string, HTMLElement> = {};
function targetEl(to: string): HTMLElement {
  if (to === 'body') return document.body;
  if (!targets[to]) {
    const el = to === 'checkbox' ? Object.assign(document.createElement('input'), { type: 'checkbox' })
      : document.createElement(to === 'input' ? 'input' : to);
    grid.appendChild(el);
    targets[to] = el;
  }
  return targets[to];
}

let clipboardLog: unknown[];
beforeEach(() => {
  vi.useFakeTimers();
  clipboardLog = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (v: string) => { clipboardLog.push(['clipboard', v]); return Promise.resolve(); } },
    configurable: true,
  });
});
afterEach(() => { vi.useRealTimers(); });

/** Callbacks that write what they were called with into the trace */
function recorder(trace: Trace) {
  const rec = (name: string, ret?: unknown) => (...args: unknown[]) => { trace.push([name, JSON.parse(JSON.stringify(args))]); return ret; };
  return rec;
}

interface Harness {
  state: () => unknown;
  apply: (step: Exclude<Step, { kind: 'key' }>) => void;
}

function run(steps: Step[], mount: (trace: Trace) => Harness & { unmount: () => void }, { ignoreTabPrevent = false } = {}): Trace {
  const trace: Trace = [];
  clipboardLog = [];
  const h = mount(trace);
  let target: HTMLElement = document.body;
  for (const step of steps) {
    if (step.kind === 'key') {
      const e = new KeyboardEvent('keydown', {
        key: step.key, ctrlKey: !!step.ctrl, metaKey: !!step.meta, shiftKey: !!step.shift, altKey: !!step.alt,
        bubbles: true, cancelable: true,
      });
      act(() => {
        grid.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // working in the grid
        target.dispatchEvent(e);
      });
      const prevented = ignoreTabPrevent && step.key === 'Tab' ? 'not compared' : e.defaultPrevented;
      trace.push(['key', step, prevented, h.state(), clipboardLog.splice(0)]);
    } else if (step.kind === 'target') {
      target = targetEl(step.to);
    } else if (step.kind === 'time') {
      act(() => { vi.advanceTimersByTime(step.ms); });
      trace.push(['time', step.ms, h.state()]);
    } else {
      h.apply(step);
      trace.push(['prop', step, h.state()]);
    }
  }
  act(() => { vi.advanceTimersByTime(5000); });
  trace.push(['end', h.state()]);
  h.unmount();
  return trace;
}

// ---------------------------------------------------------------------------------------------
// Gantt: useGridKeyboard (new) vs the reference copy
// ---------------------------------------------------------------------------------------------
type GanttProps = Parameters<typeof useGridKeyboard>[0];
interface GanttScenario { name: string; readOnly?: boolean; noBulk?: boolean; noDuplicate?: boolean; noReorder?: boolean; hidden?: string[] }

function mountGantt(useHook: (p: GanttProps) => { focusedCell: unknown; pasteFlash: unknown }, sc: GanttScenario) {
  return (trace: Trace) => {
    const rec = recorder(trace);
    const rows = buildFlatRows(TASKS);
    let props: GanttProps = {
      tasks: TASKS,
      rows,
      editingCell: null,
      activeTaskId: null,
      onTaskUpdate: sc.readOnly ? undefined : rec('onTaskUpdate'),
      onTaskReorder: sc.noReorder ? undefined : rec('onTaskReorder'),
      onTaskSelect: rec('onTaskSelect'),
      onDuplicateTasks: sc.noDuplicate ? undefined : rec('onDuplicateTasks'),
      onBulkUpdate: sc.noBulk ? undefined : rec('onBulkUpdate', Promise.resolve()) as GanttProps['onBulkUpdate'],
      startEditing: rec('startEditing'),
      getTaskFieldValue,
      rowNumToTaskId: new Map(rows.map((r, i) => [i + 1, r.task.id])),
      workCalendar: null,
      someSelected: false,
      selectedIds: new Set(),
      setBulkMessage: rec('setBulkMessage') as GanttProps['setBulkMessage'],
      orderedColumns: GANTT_COLUMNS,
      isColVisible: (c: GanttColDef) => !(sc.hidden ?? []).includes(c.key),
    };
    const hook = renderHook((p: GanttProps) => useHook(p), { initialProps: props });
    const state = () => JSON.parse(JSON.stringify({ f: hook.result.current.focusedCell, p: hook.result.current.pasteFlash }));
    return {
      state,
      unmount: hook.unmount,
      apply: (step: Exclude<Step, { kind: 'key' }>) => {
        if (step.kind === 'active') props = { ...props, activeTaskId: step.id };
        if (step.kind === 'select') props = { ...props, selectedIds: new Set(step.ids), someSelected: step.ids.length > 0 };
        if (step.kind === 'editing') {
          const f = hook.result.current.focusedCell as { taskId: string; field: GanttField } | null;
          props = { ...props, editingCell: step.on ? (f ?? { taskId: 'a', field: 'name' }) : null };
        }
        // the Gantt has no context menu prop: a no-op re-render
        act(() => { hook.rerender(props); });
      },
    };
  };
}

const GANTT_SCENARIOS: GanttScenario[] = [
  { name: 'everything wired' },
  { name: 'read-only (no onTaskUpdate)', readOnly: true },
  { name: 'no bulk update, no duplicate, no reorder', noBulk: true, noDuplicate: true, noReorder: true },
  { name: 'some columns hidden', hidden: ['pred', 'est', 'work', 'priority'] },
];

describe('Gantt grid keyboard: same results as before the share', () => {
  for (const sc of GANTT_SCENARIOS) {
    it(`${sc.name}: 12 scripted sequences give identical traces`, () => {
      let updates = 0; let flashes = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const steps = script(seed * 7919 + sc.name.length, 220);
        const before = run(steps, mountGantt(useGridKeyboardBefore as unknown as (p: GanttProps) => { focusedCell: unknown; pasteFlash: unknown }, sc));
        const after = run(steps, mountGantt(useGridKeyboard, sc));
        expect(after).toEqual(before);
        updates += before.filter(t => Array.isArray(t) && t[0] === 'onTaskUpdate').length;
        flashes += before.filter(t => Array.isArray(t) && t[0] === 'key' && (t[3] as { p: unknown }).p).length;
      }
      // the sequences really exercise updates (pastes / indents) and the paste flash
      if (!sc.readOnly) { expect(updates).toBeGreaterThan(5); expect(flashes).toBeGreaterThan(0); }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Table: useGridCellState + useTableKeyboard (new) vs the reference copy
// ---------------------------------------------------------------------------------------------
function useTableKeyboardAfter(p: TableKeyboardRefProps) {
  const {
    focusedCell, setFocusedCell, copiedValue, setCopiedValue, pasteFlash, flashPaste, copiedTasks, setCopiedTasks,
  } = useGridCellState<TableField>();
  useTableKeyboard({
    ...p, focusedCell, setFocusedCell, copiedValue, setCopiedValue, copiedTasks, setCopiedTasks, flashPaste,
  });
  return { focusedCell, setFocusedCell, pasteFlash, copiedValue, copiedTasks };
}

// Budget / Actual Cost left out since 2026-10-07: they became calculated, read-only cells (the old code
// pasted into them); that change is checked on its own below, not against the old code
const TABLE_FIELDS: TableField[] = ['name', 'status', 'priority', 'startDate', 'endDate', 'progressPercentage', 'assignedTo', 'duration', 'dependency', 'notes'];
interface TableScenario { name: string; noBulk?: boolean; noDuplicate?: boolean; readOnly?: boolean; sorted?: boolean; fields?: TableField[] }

function mountTable(useHook: (p: TableKeyboardRefProps) => ReturnType<typeof useTableKeyboardAfter>, sc: TableScenario) {
  return (trace: Trace) => {
    const rec = recorder(trace);
    // the Table's row list can be sorted differently from the plan (sort by name, descending)
    const visibleSorted = sc.sorted ? [...TASKS].sort((x, y) => y.name.localeCompare(x.name)) : TASKS;
    let props: TableKeyboardRefProps = {
      tasks: TASKS,
      visibleSorted,
      visibleFieldOrder: sc.fields ?? TABLE_FIELDS,
      selectedIds: new Set(),
      activeTaskId: null,
      editingCell: null,
      contextMenu: null,
      setContextMenu: rec('setContextMenu'),
      onTaskUpdate: sc.readOnly ? undefined : rec('onTaskUpdate'),
      onBulkUpdate: sc.noBulk ? undefined : rec('onBulkUpdate', Promise.resolve()) as TableKeyboardRefProps['onBulkUpdate'],
      onDuplicateTasks: sc.noDuplicate ? undefined : rec('onDuplicateTasks'),
      onTaskSelect: rec('onTaskSelect'),
      startEditing: rec('startEditing'),
      getTaskFieldValue,
      handleBulkDelete: rec('handleBulkDelete'),
      handleDeleteTasks: rec('handleDeleteTasks'),
      showBulkSuccess: rec('showBulkSuccess'),
      workCalendar: null,
      rowNumToTaskId: new Map(TASKS.map((t, i) => [i + 1, t.id])),
    };
    const hook = renderHook((p: TableKeyboardRefProps) => useHook(p), { initialProps: props });
    const state = () => JSON.parse(JSON.stringify({
      f: hook.result.current.focusedCell, p: hook.result.current.pasteFlash,
      cv: hook.result.current.copiedValue, ct: hook.result.current.copiedTasks.map(t => t.id),
    }));
    return {
      state,
      unmount: hook.unmount,
      apply: (step: Exclude<Step, { kind: 'key' }>) => {
        if (step.kind === 'active') props = { ...props, activeTaskId: step.id };
        if (step.kind === 'select') props = { ...props, selectedIds: new Set(step.ids) };
        if (step.kind === 'contextMenu') props = { ...props, contextMenu: step.on ? { x: 1, y: 1 } : null };
        if (step.kind === 'editing') {
          const f = hook.result.current.focusedCell;
          props = { ...props, editingCell: step.on ? (f ?? { taskId: 'a', field: 'name' }) : null };
        }
        act(() => { hook.rerender(props); });
      },
    };
  };
}

const TABLE_SCENARIOS: TableScenario[] = [
  { name: 'everything wired' },
  { name: 'no bulk update (one update per task), no duplicate', noBulk: true, noDuplicate: true },
  { name: 'read-only (no onTaskUpdate)', readOnly: true, noBulk: true },
  { name: 'rows sorted by name, fewer fields', sorted: true, fields: ['notes', 'progressPercentage', 'dependency', 'duration'] },
];

describe('Table keyboard: same results as before the share', () => {
  for (const sc of TABLE_SCENARIOS) {
    it(`${sc.name}: 12 scripted sequences give identical traces`, () => {
      let updates = 0; let flashes = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const steps = script(seed * 104729 + sc.name.length, 220);
        const before = run(steps, mountTable(useTableKeyboardBefore as unknown as (p: TableKeyboardRefProps) => ReturnType<typeof useTableKeyboardAfter>, sc), { ignoreTabPrevent: true });
        const after = run(steps, mountTable(useTableKeyboardAfter, sc), { ignoreTabPrevent: true });
        expect(after).toEqual(before);
        updates += before.filter(t => Array.isArray(t) && (t[0] === 'onTaskUpdate' || t[0] === 'onBulkUpdate')).length;
        flashes += before.filter(t => Array.isArray(t) && t[0] === 'key' && (t[3] as { p: unknown }).p).length;
      }
      if (!sc.readOnly) { expect(updates).toBeGreaterThan(5); expect(flashes).toBeGreaterThan(0); }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// The rules: where the two views differ inside the shared steps
// ---------------------------------------------------------------------------------------------
describe('GANTT_KEYBOARD_RULES / TABLE_KEYBOARD_RULES', () => {
  it('both clamp a pasted % to 0-100', () => {
    for (const rules of [GANTT_KEYBOARD_RULES, TABLE_KEYBOARD_RULES]) {
      expect(rules.toPasteValue('progressPercentage', '150')).toBe(100);
      expect(rules.toPasteValue('progressPercentage', '-5')).toBe(0);
      expect(rules.toPasteValue('progressPercentage', '40')).toBe(40);
    }
  });
  it('Gantt pastes estimates as numbers >= 0; other text as copied', () => {
    expect(GANTT_KEYBOARD_RULES.toPasteValue('estimatedDays', '-2')).toBe(0);
    expect(GANTT_KEYBOARD_RULES.toPasteValue('estimatedDurationHours', '7.5')).toBe(7.5);
    expect(GANTT_KEYBOARD_RULES.toPasteValue('name', 'X')).toBe('X');
  });
  it('Budget / Actual Cost refuse a paste in both views, on any task (calculated: hours × rate)', () => {
    for (const rules of [GANTT_KEYBOARD_RULES, TABLE_KEYBOARD_RULES]) {
      for (const field of ['budgetAllocated', 'actualCost']) {
        for (const taskId of ['a', 'c', 'p']) {
          const onTaskUpdate = vi.fn();
          const flashPaste = vi.fn();
          pasteIntoFocusedCell({
            tasks: TASKS, focusedCell: { taskId, field }, copiedValue: { field, value: '$1,200' },
            rowNumToTaskId: new Map(), onTaskUpdate, flashPaste, rules,
          });
          expect(onTaskUpdate, `${field} on ${taskId}`).not.toHaveBeenCalled();
          expect(flashPaste).not.toHaveBeenCalled();
        }
      }
    }
  });
  it('the Table pastes Notes as the description; the Gantt sends the field as is', () => {
    expect(TABLE_KEYBOARD_RULES.toPasteApiField('notes')).toBe('description');
    expect(TABLE_KEYBOARD_RULES.toPasteApiField('status')).toBe('status');
    expect(GANTT_KEYBOARD_RULES.toPasteApiField('notes')).toBe('notes');
  });
  it('Escape is a navigation key in the Gantt only', () => {
    expect(GANTT_KEYBOARD_RULES.escapeClearsFocusInNav).toBe(true);
    expect(TABLE_KEYBOARD_RULES.escapeClearsFocusInNav).toBe(false);
  });
  it('rowsToCopy: the selection in row order, else the active row, else nothing', () => {
    expect(rowsToCopy(TASKS, true, new Set(['d', 'a']), 'c').map(t => t.id)).toEqual(['a', 'd']);
    expect(rowsToCopy(TASKS, false, new Set(['d']), 'c').map(t => t.id)).toEqual(['c']);
    expect(rowsToCopy(TASKS, false, new Set(), null)).toEqual([]);
  });
});
