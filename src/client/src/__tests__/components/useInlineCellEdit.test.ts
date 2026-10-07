/**
 * useInlineCellEdit: ONE inline cell editor (start / cancel / save, Enter / Escape, dropdown and
 * date changes, the 300 ms "saving" then 1.2 s green "saved" flash, the read-out, the predecessor
 * error) shared by the Gantt grid and the Table view (2026-10-05, code-health item 4 phase 3).
 *
 * Each side's options are checked against a reference copy of that side's OLD code, pasted
 * verbatim from GanttChart.tsx / TableView.tsx at 459b55d7: the same scripted edits (keys, blur,
 * dropdowns, timers, read-only, mid-drag) must give the same state after every step, the same
 * task updates and the same read-outs. The Gantt's Tab handling stays in GanttChart.tsx and is
 * driven here through the same wrapper code (copied from GanttChart.tsx).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useRef, useEffect, useCallback } from 'react';

vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { announce } from '../../utils/announce';
import { useInlineCellEdit, GANTT_EDIT_RULES, TABLE_EDIT_RULES } from '../../components/schedule/shared/hooks/useInlineCellEdit';
import { buildFlatRows, FIELD_ORDER, type GanttTask, type FlatRow, type EditableField as GField } from '../../components/schedule/gantt/types';
import type { EditableField as TField } from '../../components/schedule/table/types';
import { planDurationEdit } from '../../components/schedule/durationEdit';
import { planPredecessorEdit } from '../../components/schedule/predecessorEdit';
import { isSummaryRollupCell } from '../../components/schedule/summaryRollup';
import { progressFromHours } from '../../utils/progressFromHours';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'A', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20, progressPercentage: 40, estimatedDays: 3, estimatedDurationHours: 8, budgetAllocated: 500, actualCost: 100, description: 'note' } as GanttTask,
  { id: 'b', name: 'B', status: 'in_progress', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30, dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] },
  { id: 'h', name: 'Hours', status: 'in_progress', startDate: '2026-03-16', endDate: '2026-03-20', parentTaskId: 'p', sortOrder: 40, progressFromHours: true } as GanttTask,
  { id: 'c', name: 'C', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 50 },
];
const ROWS = buildFlatRows(TASKS);
const ROW_NUM_TO_ID = new Map<number, string>(ROWS.map((r, i) => [i + 1, r.task.id]));
const ID_TO_ROW_NUM = new Map<string, number>(ROWS.map((r, i) => [r.task.id, i + 1]));

/** Stand-in for each view's getTaskFieldValue (passed in; the editor only compares with it and seeds the input) */
const fieldValue = (task: GanttTask, field: string): string => {
  const t = task as any;
  switch (field) {
    case 'name': return t.name || '';
    case 'status': return t.status || 'pending';
    case 'startDate': return t.startDate?.split('T')[0] || '';
    case 'endDate': return t.endDate?.split('T')[0] || '';
    case 'duration': { const d = workingDaysBetween(t.startDate, t.endDate); return d != null ? String(d) : ''; }
    case 'dependency': return (t.dependencies || []).map((d: any) => String(ID_TO_ROW_NUM.get(d.dependencyId))).join(',');
    case 'progressPercentage': return String(t.progressPercentage ?? 0);
    case 'estimatedDays': return t.estimatedDays != null ? String(t.estimatedDays) : '';
    case 'estimatedDurationHours': return t.estimatedDurationHours != null ? String(t.estimatedDurationHours) : '';
    case 'budgetAllocated': return t.budgetAllocated != null ? String(t.budgetAllocated) : '';
    case 'actualCost': return t.actualCost != null ? String(t.actualCost) : '';
    case 'notes': return t.description || '';
    default: return '';
  }
};

interface Props {
  tasks: GanttTask[];
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  getTaskFieldValue: (task: GanttTask, field: any) => string;
  rowNumToTaskId: Map<number, string>;
  workCalendar?: WorkCalendar | null;
  drag: unknown;
  rows: FlatRow[];
}

// ---------------------------------------------------------------------------
// The new code, as each view calls it
// ---------------------------------------------------------------------------
function useNewGantt(p: Props) {
  type EditableField = GField;
  const { rows } = p;
  const {
    editingCell, editValue, setEditValue, savingCell, savedCell, depError,
    startEditing, cancelEditing, saveEdit,
    handleKeyDown: handleEditKeyDown, handleSelectChange, handleDateChange,
  } = useInlineCellEdit<EditableField>({
    tasks: p.tasks, onTaskUpdate: p.onTaskUpdate, getTaskFieldValue: p.getTaskFieldValue, rowNumToTaskId: p.rowNumToTaskId, workCalendar: p.workCalendar,
    blockEditingWhile: p.drag, rules: GANTT_EDIT_RULES,
  });
  // --- copied from GanttChart.tsx ---
  // Enter saves and Escape cancels (shared editor); Tab saves and moves to the next editable cell (Gantt only)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter' || e.key === 'Escape') handleEditKeyDown(e, taskId, field);
    else if (e.key === 'Tab') {
      e.preventDefault();
      // Save current cell first
      saveEdit(taskId, field, editValue);
      // Navigate to next/prev editable field (on a summary row, past the cells it can't edit)
      const rowIdx = rows.findIndex(r => r.task.id === taskId);
      if (rowIdx === -1) return;
      const step = e.shiftKey ? -1 : 1;
      let r = rowIdx;
      let f = FIELD_ORDER.indexOf(field);
      for (let guard = 0; guard < FIELD_ORDER.length * 2; guard++) {
        f += step;
        if (f < 0) { r -= 1; f = FIELD_ORDER.length - 1; }
        else if (f >= FIELD_ORDER.length) { r += 1; f = 0; }
        if (r < 0 || r >= rows.length) return;
        if (!isSummaryRollupCell(rows[r].task, FIELD_ORDER[f])) {
          startEditing(rows[r].task.id, FIELD_ORDER[f], rows[r].task);
          return;
        }
      }
    }
  }, [handleEditKeyDown, saveEdit, editValue, rows, startEditing]);
  // --- end copy ---
  return { editingCell, editValue, setEditValue, savingCell, savedCell, depError, startEditing, cancelEditing, saveEdit, handleKeyDown, handleSelectChange, handleDateChange };
}

function useNewTable(p: Props) {
  return useInlineCellEdit<TField>({
    tasks: p.tasks, onTaskUpdate: p.onTaskUpdate, getTaskFieldValue: p.getTaskFieldValue, rowNumToTaskId: p.rowNumToTaskId, workCalendar: p.workCalendar,
    rules: TABLE_EDIT_RULES,
  });
}

// ---------------------------------------------------------------------------
// Reference: the OLD GanttChart.tsx code, verbatim
// ---------------------------------------------------------------------------
function useOldGantt(p: Props) {
  type EditableField = GField;
  const { tasks, onTaskUpdate, getTaskFieldValue, rowNumToTaskId, workCalendar, drag, rows } = p;
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  // savingCell tracks the cell currently being saved (used for timing the green flash)
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  void savingCell; // read to satisfy TS — value used internally for save timing
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const startEditing = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    // % complete from approved hours can't be typed (mark the task done instead)
    if (field === 'progressPercentage' && progressFromHours(task as any)) return;
    if (!onTaskUpdate || drag) return;
    // A summary's dates, % complete and status come from its tasks (same rule as the Table view)
    if (isSummaryRollupCell(task, field)) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
    setDepError(null);
  }, [onTaskUpdate, drag, getTaskFieldValue]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
    setDepError(null);
  }, []);

  const saveEdit = useCallback((taskId: string, field: EditableField, value: string) => {
    if (!onTaskUpdate) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

    // Name cannot be empty
    if (field === 'name' && !value.trim()) { cancelEditing(); return; }

    // Duration: compute new endDate
    if (field === 'duration') {
      const plan = planDurationEdit(task, value, workCalendar);
      if (!plan.ok) { cancelEditing(); return; }
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate(taskId, plan.patch);
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    // Dependency: multi-dep parsing
    if (field === 'dependency') {
      const plan = planPredecessorEdit(value, taskId, rowNumToTaskId);
      if (!plan.ok) { setDepError({ taskId, message: plan.message }); return; }
      setDepError(null);
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate(taskId, plan.patch);
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    const saveValue = field === 'progressPercentage'
      ? Math.max(0, Math.min(100, Number(value)))
      : field === 'estimatedDays' || field === 'estimatedDurationHours'
        ? Math.max(0, Number(value))
        : value;

    setSavingCell({ taskId, field });
    setEditingCell(null);
    setEditValue('');
    onTaskUpdate(taskId, { [field]: saveValue });
    setTimeout(() => {
      setSavingCell(null);
      setSavedCell({ taskId, field });
      announce(`${field} saved`);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
    }, 300);
  }, [onTaskUpdate, tasks, getTaskFieldValue, cancelEditing, rowNumToTaskId, workCalendar]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      // Save current cell first
      saveEdit(taskId, field, editValue);
      // Navigate to next/prev editable field (on a summary row, past the cells it can't edit)
      const rowIdx = rows.findIndex(r => r.task.id === taskId);
      if (rowIdx === -1) return;
      const step = e.shiftKey ? -1 : 1;
      let r = rowIdx;
      let f = FIELD_ORDER.indexOf(field);
      for (let guard = 0; guard < FIELD_ORDER.length * 2; guard++) {
        f += step;
        if (f < 0) { r -= 1; f = FIELD_ORDER.length - 1; }
        else if (f >= FIELD_ORDER.length) { r += 1; f = 0; }
        if (r < 0 || r >= rows.length) return;
        if (!isSummaryRollupCell(rows[r].task, FIELD_ORDER[f])) {
          startEditing(rows[r].task.id, FIELD_ORDER[f], rows[r].task);
          return;
        }
      }
    }
  }, [saveEdit, cancelEditing, editValue, rows, startEditing]);

  const handleSelectChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  const handleDateChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  return { editingCell, editValue, setEditValue, savingCell, savedCell, depError, startEditing, cancelEditing, saveEdit, handleKeyDown, handleSelectChange, handleDateChange };
}

// ---------------------------------------------------------------------------
// Reference: the OLD TableView.tsx code, verbatim
// ---------------------------------------------------------------------------
function useOldTable(p: Props) {
  type EditableField = TField;
  const { tasks, onTaskUpdate, getTaskFieldValue, rowNumToTaskId, workCalendar } = p;
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const startEditing = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    // % complete from approved hours can't be typed (mark the task done instead)
    if (field === 'progressPercentage' && progressFromHours(task as any)) return;
    if (!onTaskUpdate) return; // read-only mode
    if (isSummaryRollupCell(task, field)) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
  }, [getTaskFieldValue, onTaskUpdate]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback((taskId: string, field: EditableField, value: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

    if (field === 'duration') {
      const plan = planDurationEdit(task, value, workCalendar);
      if (!plan.ok) { cancelEditing(); return; }
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate?.(taskId, plan.patch);
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    if (field === 'dependency') {
      const plan = planPredecessorEdit(value, taskId, rowNumToTaskId);
      if (!plan.ok) {
        setDepError({ taskId, message: plan.message });
        return;
      }
      setDepError(null);
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate?.(taskId, plan.patch);
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    const saveValue = field === 'progressPercentage'
      ? Math.max(0, Math.min(100, Number(value)))
      : (field === 'budgetAllocated' || field === 'actualCost')
        ? (value === '' ? null : Math.max(0, Number(value.replace(/[,$]/g, ''))))
        : value;

    setSavingCell({ taskId, field });
    setEditingCell(null);
    setEditValue('');

    const apiField = field === 'notes' ? 'description' : field;
    onTaskUpdate?.(taskId, { [apiField]: saveValue });

    setTimeout(() => {
      setSavingCell(null);
      setSavedCell({ taskId, field });
      announce(`${field} saved`);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
    }, 300);
  }, [tasks, getTaskFieldValue, cancelEditing, onTaskUpdate, rowNumToTaskId, workCalendar]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  }, [saveEdit, editValue, cancelEditing]);

  const handleSelectChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  const handleDateChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  return { editingCell, editValue, setEditValue, savingCell, savedCell, depError, startEditing, cancelEditing, saveEdit, handleKeyDown, handleSelectChange, handleDateChange };
}

// ---------------------------------------------------------------------------
// Driving both the same way
// ---------------------------------------------------------------------------
type Step =
  | ['start', string, string]
  | ['set', string]
  | ['key', string, string, string, boolean?]
  | ['save', string, string, string | null]
  | ['select', string, string, string]
  | ['date', string, string, string]
  | ['cancel']
  | ['tick', number];

interface Api {
  editingCell: { taskId: string; field: string } | null;
  editValue: string;
  savingCell: { taskId: string; field: string } | null;
  savedCell: { taskId: string; field: string } | null;
  depError: { taskId: string; message: string } | null;
  setEditValue: (v: string) => void;
  startEditing: (taskId: string, field: any, task: GanttTask) => void;
  cancelEditing: () => void;
  saveEdit: (taskId: string, field: any, value: string) => void;
  handleKeyDown: (e: any, taskId: string, field: any) => void;
  handleSelectChange: (taskId: string, field: any, value: string) => void;
  handleDateChange: (taskId: string, field: any, value: string) => void;
}

function run(useIt: (p: Props) => Api, props: Props, steps: Step[]) {
  const announceMock = vi.mocked(announce);
  announceMock.mockClear();
  const onTaskUpdate = props.onTaskUpdate ? vi.fn() : undefined;
  const p = { ...props, onTaskUpdate };
  const { result, unmount } = renderHook((q: Props) => useIt(q), { initialProps: p });
  const log: unknown[] = [];
  const snap = (label: string, extra: Record<string, unknown> = {}) => {
    const c = result.current;
    log.push({
      label, ...extra,
      editingCell: c.editingCell, editValue: c.editValue, savingCell: c.savingCell, savedCell: c.savedCell, depError: c.depError,
      updates: onTaskUpdate ? onTaskUpdate.mock.calls.length : 'none',
      announced: announceMock.mock.calls.length,
    });
  };
  const task = (id: string) => TASKS.find(t => t.id === id)!;
  for (const s of steps) {
    const c = result.current;
    let extra: Record<string, unknown> = {};
    act(() => {
      switch (s[0]) {
        case 'start': c.startEditing(s[1], s[2], task(s[1])); break;
        case 'set': c.setEditValue(s[1]); break;
        case 'key': {
          const e = { key: s[1], shiftKey: !!s[4], preventDefault: vi.fn() };
          c.handleKeyDown(e, s[2], s[3]);
          extra = { prevented: e.preventDefault.mock.calls.length };
          break;
        }
        case 'save': c.saveEdit(s[1], s[2], s[3] ?? c.editValue); break;
        case 'select': c.handleSelectChange(s[1], s[2], s[3]); break;
        case 'date': c.handleDateChange(s[1], s[2], s[3]); break;
        case 'cancel': c.cancelEditing(); break;
        case 'tick': vi.advanceTimersByTime(s[1]); break;
      }
    });
    snap(s.join(' '), extra);
  }
  const out = { log, calls: onTaskUpdate?.mock.calls ?? null, announced: announceMock.mock.calls.map(a => a[0]) };
  unmount();
  return out;
}

const SCENARIOS: Array<[string, Step[]]> = [
  ['type a name, Enter, saving 300 ms then saved 1.2 s', [['start', 'a', 'name'], ['set', 'A2'], ['key', 'Enter', 'a', 'name'], ['tick', 299], ['tick', 1], ['tick', 1199], ['tick', 1]]],
  ['unchanged value: Enter just closes', [['start', 'a', 'name'], ['key', 'Enter', 'a', 'name'], ['tick', 2000]]],
  ['blank name', [['start', 'a', 'name'], ['set', '   '], ['key', 'Enter', 'a', 'name'], ['tick', 300], ['tick', 1200]]],
  ['Escape cancels', [['start', 'a', 'status'], ['set', 'completed'], ['key', 'Escape', 'a', 'status'], ['tick', 2000]]],
  ['other keys do nothing', [['start', 'a', 'name'], ['set', 'Q'], ['key', 'x', 'a', 'name'], ['key', 'ArrowDown', 'a', 'name']]],
  ['blur saves what was typed', [['start', 'c', 'name'], ['set', 'C!'], ['save', 'c', 'name', null], ['tick', 300], ['tick', 1200]]],
  ['duration: valid', [['start', 'a', 'duration'], ['set', '10'], ['key', 'Enter', 'a', 'duration'], ['tick', 300], ['tick', 1200]]],
  ['duration: not a number cancels', [['start', 'a', 'duration'], ['set', 'abc'], ['key', 'Enter', 'a', 'duration'], ['tick', 2000]]],
  ['duration on a summary is refused', [['start', 'p', 'duration'], ['save', 'p', 'duration', '5'], ['tick', 2000]]],
  ['predecessors: valid', [['start', 'b', 'dependency'], ['set', '2SS+1d'], ['key', 'Enter', 'b', 'dependency'], ['tick', 300], ['tick', 1200]]],
  ['predecessors: bad, then Escape, then edit another cell', [['start', 'b', 'dependency'], ['set', 'zz'], ['key', 'Enter', 'b', 'dependency'], ['tick', 2000], ['key', 'Escape', 'b', 'dependency'], ['start', 'a', 'name']]],
  ['predecessors: itself, then start another edit', [['start', 'b', 'dependency'], ['set', '3'], ['key', 'Enter', 'b', 'dependency'], ['start', 'a', 'name']]],
  ['predecessors: bad then fixed', [['start', 'b', 'dependency'], ['set', '99'], ['key', 'Enter', 'b', 'dependency'], ['set', '2FF'], ['key', 'Enter', 'b', 'dependency'], ['tick', 300], ['tick', 1200]]],
  ['% clamps above 100', [['start', 'a', 'progressPercentage'], ['set', '150'], ['key', 'Enter', 'a', 'progressPercentage'], ['tick', 300], ['tick', 1200]]],
  ['% clamps below 0', [['start', 'a', 'progressPercentage'], ['set', '-5'], ['key', 'Enter', 'a', 'progressPercentage'], ['tick', 300]]],
  ['% from approved hours does not open', [['start', 'h', 'progressPercentage'], ['start', 'h', 'name']]],
  ["a summary's roll-up cells do not open; its name does", [['start', 'p', 'startDate'], ['start', 'p', 'endDate'], ['start', 'p', 'progressPercentage'], ['start', 'p', 'status'], ['start', 'p', 'name']]],
  ['dropdown change saves at once', [['start', 'a', 'status'], ['select', 'a', 'status', 'completed'], ['tick', 300], ['tick', 1200]]],
  ['dropdown change to the same value closes', [['start', 'a', 'status'], ['select', 'a', 'status', 'pending'], ['tick', 2000]]],
  ['date picker change saves at once', [['start', 'a', 'endDate'], ['date', 'a', 'endDate', '2026-03-10'], ['tick', 300], ['tick', 1200]]],
  ['estimate below zero', [['start', 'a', 'estimatedDays'], ['set', '-3'], ['key', 'Enter', 'a', 'estimatedDays'], ['tick', 300]]],
  ['work hours', [['start', 'a', 'estimatedDurationHours'], ['set', '12.5'], ['key', 'Enter', 'a', 'estimatedDurationHours'], ['tick', 300]]],
  ['budget typed as $1,200', [['start', 'a', 'budgetAllocated'], ['set', '$1,200'], ['key', 'Enter', 'a', 'budgetAllocated'], ['tick', 300]]],
  ['budget cleared', [['start', 'a', 'budgetAllocated'], ['set', ''], ['key', 'Enter', 'a', 'budgetAllocated'], ['tick', 300]]],
  ['actual cost negative', [['start', 'a', 'actualCost'], ['set', '-40'], ['key', 'Enter', 'a', 'actualCost'], ['tick', 300]]],
  ['notes', [['start', 'a', 'notes'], ['set', 'new note'], ['key', 'Enter', 'a', 'notes'], ['tick', 300]]],
  ['a second save restarts the saved-flash timer', [['save', 'a', 'name', 'X'], ['tick', 300], ['tick', 600], ['save', 'c', 'name', 'Y'], ['tick', 300], ['tick', 900], ['tick', 299], ['tick', 1]]],
  ['two saves inside 300 ms', [['save', 'a', 'name', 'X'], ['tick', 100], ['save', 'c', 'status', 'completed'], ['tick', 200], ['tick', 100], ['tick', 1200]]],
  ['unknown task does nothing', [['save', 'zz', 'name', 'Q'], ['tick', 2000]]],
  ['cancel with nothing open', [['cancel']]],
];

function bothMatch(useNew: (p: Props) => Api, useOld: (p: Props) => Api, props: Props, steps: Step[]) {
  vi.useFakeTimers();
  const a = run(useNew, props, steps);
  vi.useRealTimers();
  vi.useFakeTimers();
  const b = run(useOld, props, steps);
  vi.useRealTimers();
  expect(a).toEqual(b);
  return a;
}

const BASE: Props = { tasks: TASKS, onTaskUpdate: () => {}, getTaskFieldValue: fieldValue, rowNumToTaskId: ROW_NUM_TO_ID, workCalendar: null, drag: null, rows: ROWS };

// Budget / Actual Cost became calculated, read-only cells in both views (2026-10-07): the old code
// opened and sent them; now nothing opens and nothing is sent — checked below, not against the old code
const CALCULATED_CHANGED_ON_PURPOSE = new Set(['budget typed as $1,200', 'budget cleared', 'actual cost negative']);

describe('useInlineCellEdit with the Gantt rules behaves exactly like the old GanttChart code', () => {
  for (const [name, steps] of SCENARIOS) {
    if (CALCULATED_CHANGED_ON_PURPOSE.has(name)) continue;
    it(name, () => { bothMatch(useNewGantt, useOldGantt, BASE, steps); });
    it(`${name} (read-only)`, () => { bothMatch(useNewGantt, useOldGantt, { ...BASE, onTaskUpdate: undefined }, steps); });
    it(`${name} (while a bar is dragged)`, () => { bothMatch(useNewGantt, useOldGantt, { ...BASE, drag: { taskId: 'a' } }, steps); });
  }
  const TAB: Array<[string, Step[]]> = [
    ['Tab saves and opens the next cell', [['start', 'a', 'name'], ['set', 'A9'], ['key', 'Tab', 'a', 'name'], ['tick', 300], ['tick', 1200]]],
    ['Shift+Tab goes back, to the previous row', [['start', 'b', 'name'], ['key', 'Tab', 'b', 'name', true]]],
    ['Tab from the last field wraps to the next row', [['start', 'a', 'status'], ['key', 'Tab', 'a', 'status']]],
    ["Tab on a summary row skips its roll-up cells", [['start', 'p', 'dependency'], ['key', 'Tab', 'p', 'dependency'], ['key', 'Tab', 'p', 'estimatedDays']]],
    ['Tab past the last row stops', [['start', 'c', 'status'], ['set', 'completed'], ['key', 'Tab', 'c', 'status'], ['tick', 300]]],
    ['Tab with a bad predecessor keeps the error and moves on', [['start', 'b', 'dependency'], ['set', 'zz'], ['key', 'Tab', 'b', 'dependency']]],
  ];
  for (const [name, steps] of TAB) {
    it(name, () => { bothMatch(useNewGantt, useOldGantt, BASE, steps); });
  }
});

// The old TableView had no Est Days / Work columns; since 2026-10-06 the Table has them and saves
// them as the Gantt does (numbers >= 0) — checked against the Gantt below, not the old Table code
const TABLE_CHANGED_ON_PURPOSE = new Set(['estimate below zero', 'work hours']);

describe('useInlineCellEdit with the Table rules behaves exactly like the old TableView code', () => {
  for (const [name, steps] of SCENARIOS) {
    if (TABLE_CHANGED_ON_PURPOSE.has(name) || CALCULATED_CHANGED_ON_PURPOSE.has(name)) continue;
    it(name, () => { bothMatch(useNewTable, useOldTable, BASE, steps); });
    it(`${name} (read-only)`, () => { bothMatch(useNewTable, useOldTable, { ...BASE, onTaskUpdate: undefined }, steps); });
  }
  it('Tab is left to the browser (no save, nothing prevented)', () => {
    const r = bothMatch(useNewTable, useOldTable, BASE, [['start', 'a', 'name'], ['set', 'A9'], ['key', 'Tab', 'a', 'name']]);
    expect(r.calls).toEqual([]);
    expect((r.log[2] as { prevented: number }).prevented).toBe(0);
  });
});

describe('the differences the two views keep (spelled out)', () => {
  const lastCall = (useIt: (p: Props) => Api, steps: Step[], props: Props = BASE) => {
    vi.useFakeTimers();
    const r = run(useIt, props, steps);
    vi.useRealTimers();
    return r;
  };
  it('a blank name: Gantt drops it, Table sends it', () => {
    const steps: Step[] = [['start', 'a', 'name'], ['set', '  '], ['key', 'Enter', 'a', 'name']];
    expect(lastCall(useNewGantt, steps).calls).toEqual([]);
    expect(lastCall(useNewTable, steps).calls).toEqual([['a', { name: '  ' }]]);
  });
  it('Notes: Table saves it as the description', () => {
    expect(lastCall(useNewTable, [['save', 'a', 'notes', 'n2']]).calls).toEqual([['a', { description: 'n2' }]]);
    expect(lastCall(useNewGantt, [['save', 'a', 'notes', 'n2']]).calls).toEqual([['a', { notes: 'n2' }]]);
  });
  it('estimates: both make numbers >= 0 (Table since 2026-10-06)', () => {
    expect(lastCall(useNewGantt, [['save', 'a', 'estimatedDays', '-3']]).calls).toEqual([['a', { estimatedDays: 0 }]]);
    expect(lastCall(useNewTable, [['save', 'a', 'estimatedDays', '-3']]).calls).toEqual([['a', { estimatedDays: 0 }]]);
    expect(lastCall(useNewTable, [['save', 'a', 'estimatedDurationHours', '12.5']]).calls).toEqual([['a', { estimatedDurationHours: 12.5 }]]);
  });
  for (const name of CALCULATED_CHANGED_ON_PURPOSE) {
    it(`${name}: Budget / Actual Cost don't open and send nothing in either view (calculated)`, () => {
      const steps = SCENARIOS.find(([n]) => n === name)![1];
      for (const useIt of [useNewGantt, useNewTable]) {
        const r = lastCall(useIt, steps);
        expect(r.calls).toEqual([]);
        expect(r.announced).toEqual([]);
        expect((r.log as Array<{ editingCell?: unknown }>).every(l => l.editingCell == null)).toBe(true);
      }
    });
  }
  it('Budget / Actual Cost: a save reaching the hook directly is dropped too', () => {
    for (const useIt of [useNewGantt, useNewTable]) {
      expect(lastCall(useIt, [['save', 'a', 'budgetAllocated', '$1,200'], ['tick', 2000]]).calls).toEqual([]);
      expect(lastCall(useIt, [['save', 'a', 'actualCost', '40'], ['tick', 2000]]).calls).toEqual([]);
    }
  });
  for (const name of TABLE_CHANGED_ON_PURPOSE) {
    it(`${name}: the Table now does exactly what the Gantt does`, () => {
      const steps = SCENARIOS.find(([n]) => n === name)![1];
      expect(lastCall(useNewTable, steps).calls).toEqual(lastCall(useNewGantt, steps).calls);
    });
  }
  it('a predecessor error: Gantt clears it on Escape / a new edit, Table keeps it', () => {
    const steps: Step[] = [['start', 'b', 'dependency'], ['set', 'zz'], ['key', 'Enter', 'b', 'dependency'], ['key', 'Escape', 'b', 'dependency']];
    const g = lastCall(useNewGantt, steps).log as Array<{ depError: unknown }>;
    const t = lastCall(useNewTable, steps).log as Array<{ depError: unknown }>;
    expect(g[2].depError).toBeTruthy();
    expect(g[3].depError).toBeNull();
    expect(t[3].depError).toBeTruthy();
  });
  it('read-only: Gantt ignores a save, Table still shows the saving/saved flash', () => {
    const steps: Step[] = [['save', 'a', 'name', 'Z'], ['tick', 300]];
    const g = lastCall(useNewGantt, steps, { ...BASE, onTaskUpdate: undefined }).log as Array<{ savedCell: unknown }>;
    const t = lastCall(useNewTable, steps, { ...BASE, onTaskUpdate: undefined }).log as Array<{ savedCell: unknown }>;
    expect(g[1].savedCell).toBeNull();
    expect(t[1].savedCell).toEqual({ taskId: 'a', field: 'name' });
  });
  it('the saved flash and the read-out are the same for both', () => {
    for (const useIt of [useNewGantt, useNewTable]) {
      const r = lastCall(useIt, [['save', 'a', 'name', 'N'], ['tick', 299], ['tick', 1], ['tick', 1199], ['tick', 1]]);
      const log = r.log as Array<{ savingCell: unknown; savedCell: unknown }>;
      expect(log[0].savingCell).toEqual({ taskId: 'a', field: 'name' });
      expect(log[1].savingCell).toEqual({ taskId: 'a', field: 'name' });
      expect(log[2].savedCell).toEqual({ taskId: 'a', field: 'name' });
      expect(log[3].savedCell).toEqual({ taskId: 'a', field: 'name' });
      expect(log[4].savedCell).toBeNull();
      expect(r.announced).toEqual(['name saved']);
    }
  });
  it('unmounting clears the pending saved-flash timer', () => {
    for (const useIt of [useNewGantt, useNewTable]) {
      vi.useFakeTimers();
      const { result, unmount } = renderHook((q: Props) => useIt(q), { initialProps: BASE });
      act(() => { result.current.saveEdit('a', 'name', 'U'); });
      act(() => { vi.advanceTimersByTime(300); });
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
    }
  });
});
