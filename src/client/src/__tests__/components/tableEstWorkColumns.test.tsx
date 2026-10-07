// @vitest-environment happy-dom
/**
 * Table: Est Days (estimated days) and Work (effort hours) columns (2026-10-06). The Gantt grid
 * had Est and Work but the Table didn't, and the project schedule's Gantt uses the Table's column
 * picker — so they could never be switched on there. The Table's columns copy the Gantt's: the
 * same display ("5d", "40h", no rounding, a dash when blank), the same edit (numbers only, never
 * below zero, the same payload field names), the same summary-row rule, the same paste clamp,
 * and blanks sort last.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { TableView } from '../../components/schedule/TableView';
import type { GanttTask } from '../../components/schedule/GanttChart';
import { useColumnState } from '../../hooks/useColumnState';
import { COLUMN_DEFS, DEFAULT_VISIBLE_KEYS } from '../../components/schedule/tableColumns';
import { GANTT_TO_TABLE_KEY, TABLE_TO_GANTT_KEY } from '../../components/schedule/columnKeyMap';
import { GANTT_SORT_FIELD } from '../../components/schedule/sortValues';
import { isSummaryRollupCell } from '../../components/schedule/summaryRollup';
import { useTableGrouping } from '../../components/schedule/table/hooks/useTableGrouping';
import { buildRowNumberMap } from '../../components/schedule/gantt/types';
import { GANTT_EDIT_RULES, TABLE_EDIT_RULES } from '../../components/schedule/shared/hooks/useInlineCellEdit';
import {
  GANTT_KEYBOARD_RULES, TABLE_KEYBOARD_RULES, pasteIntoFocusedCell,
} from '../../components/schedule/shared/hooks/useGridKeyboardPaste';

const SID = 's-est-work';
const DASH = '—';

// p is a summary over a, b, c. a has both values; b has decimals; c has neither.
const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', isSummary: true, estimatedDays: 15, estimatedDurationHours: 80, sortOrder: 10 },
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', estimatedDays: 5, estimatedDurationHours: 40, sortOrder: 20 },
  { id: 'b', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', estimatedDays: 2.5, estimatedDurationHours: 12.25, sortOrder: 30 },
  { id: 'c', name: 'Check', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', parentTaskId: 'p', sortOrder: 40, assignedTo: 'r1', progressFromHours: true },
];

function Table({ tasks, onTaskUpdate, activeTaskId }: { tasks: GanttTask[]; onTaskUpdate: (id: string, d: Record<string, unknown>) => void; activeTaskId?: string }) {
  const columnState = useColumnState(SID);
  return <TableView tasks={tasks} scheduleId={SID} onTaskClick={() => {}} columnState={columnState} onTaskUpdate={onTaskUpdate} activeTaskId={activeTaskId} />;
}

function setup(activeTaskId?: string, tasks: GanttTask[] = TASKS) {
  const onTaskUpdate = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><Table tasks={tasks} onTaskUpdate={onTaskUpdate} activeTaskId={activeTaskId} /></QueryClientProvider>);
  const { container } = utils;
  const headers = Array.from(container.querySelectorAll('thead tr:first-child th')).map(th => th.textContent?.trim() ?? '');
  const colIdx = (label: string) => {
    const i = headers.findIndex(h => h.startsWith(label));
    expect(i, `header ${label} in ${headers.join('|')}`).toBeGreaterThan(-1);
    return i;
  };
  const row = (name: string) => Array.from(container.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes(name)) as HTMLElement;
  const cell = (name: string, label: string) => row(name).children[colIdx(label)] as HTMLElement;
  const rerender = (next: GanttTask[], active?: string) => utils.rerender(
    <QueryClientProvider client={qc}><Table tasks={next} onTaskUpdate={onTaskUpdate} activeTaskId={active} /></QueryClientProvider>,
  );
  return { container, onTaskUpdate, cell, headers, rerender };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(`tableview-cols:${SID}`, JSON.stringify(['rowNum', 'name', 'duration', 'estimatedDays', 'estimatedDurationHours', 'progressPercentage']));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('column definitions and pairing', () => {
  it('Est Days and Work are Table columns, hidden by default, editable and sortable, in the picker', () => {
    const est = COLUMN_DEFS.find(c => c.key === 'estimatedDays');
    const work = COLUMN_DEFS.find(c => c.key === 'estimatedDurationHours');
    expect(est).toMatchObject({ label: 'Est Days', defaultVisible: false, editable: true, sortable: true });
    expect(work).toMatchObject({ label: 'Work', defaultVisible: false, editable: true, sortable: true });
    expect(DEFAULT_VISIBLE_KEYS.has('estimatedDays')).toBe(false);
    expect(DEFAULT_VISIBLE_KEYS.has('estimatedDurationHours')).toBe(false);
  });

  it('pair with the Gantt\'s Est / Work both ways, and sort by the same field as the Gantt', () => {
    expect(GANTT_TO_TABLE_KEY.est).toBe('estimatedDays');
    expect(GANTT_TO_TABLE_KEY.work).toBe('estimatedDurationHours');
    expect(TABLE_TO_GANTT_KEY.estimatedDays).toBe('est');
    expect(TABLE_TO_GANTT_KEY.estimatedDurationHours).toBe('work');
    expect(GANTT_SORT_FIELD.est).toBe('estimatedDays');
    expect(GANTT_SORT_FIELD.work).toBe('estimatedDurationHours');
  });

  it('a table with no saved columns does not show them', () => {
    localStorage.clear();
    const { headers } = setup();
    expect(headers.some(h => h.startsWith('Est Days'))).toBe(false);
    expect(headers.some(h => h === 'Work' || h.startsWith('Work'))).toBe(false);
  });
});

describe('display — same as the Gantt grid', () => {
  it('days as "5d", hours as "40h", no rounding, a dash when blank', () => {
    const { cell } = setup();
    expect(cell('Plan', 'Est Days').textContent).toBe('5d');
    expect(cell('Plan', 'Work').textContent).toBe('40h');
    expect(cell('Build', 'Est Days').textContent).toBe('2.5d');
    expect(cell('Build', 'Work').textContent).toBe('12.25h');
    expect(cell('Check', 'Est Days').textContent).toBe(DASH);
    expect(cell('Check', 'Work').textContent).toBe(DASH);
  });
});

describe('inline edit — same payload and clamp as the Gantt grid', () => {
  it('Est Days: a named number input; saves { estimatedDays: n }', () => {
    const { cell, onTaskUpdate } = setup('a');
    fireEvent.click(cell('Plan', 'Est Days'));
    const input = cell('Plan', 'Est Days').querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Estimate (days) for Plan');
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTaskUpdate).toHaveBeenCalledWith('a', { estimatedDays: 7 });
  });

  it('Work: a named number input in half-hour steps; saves { estimatedDurationHours: n }', () => {
    const { cell, onTaskUpdate } = setup('a');
    fireEvent.click(cell('Plan', 'Work'));
    const input = cell('Plan', 'Work').querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Work (hours) for Plan');
    expect(input.step).toBe('0.5');
    fireEvent.change(input, { target: { value: '37.5' } });
    fireEvent.blur(input);
    expect(onTaskUpdate).toHaveBeenCalledWith('a', { estimatedDurationHours: 37.5 });
  });

  it('refuses a negative: saved as 0, exactly as the Gantt would', () => {
    const { cell, onTaskUpdate } = setup('a');
    fireEvent.click(cell('Plan', 'Est Days'));
    const input = cell('Plan', 'Est Days').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTaskUpdate).toHaveBeenCalledWith('a', { estimatedDays: 0 });
    for (const f of ['estimatedDays', 'estimatedDurationHours']) {
      for (const v of ['-3', '0', '4', '2.5']) {
        expect(TABLE_EDIT_RULES.toSaveValue(f, v)).toBe(GANTT_EDIT_RULES.toSaveValue(f, v));
        expect(TABLE_EDIT_RULES.toApiField(f)).toBe(GANTT_EDIT_RULES.toApiField(f));
      }
    }
  });

  it('an unchanged value saves nothing', () => {
    const { cell, onTaskUpdate } = setup('a');
    fireEvent.click(cell('Plan', 'Work'));
    const input = cell('Plan', 'Work').querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });
});

describe('summary rows — the Gantt\'s rule', () => {
  it('a summary\'s rolled-up Duration does not open; Est Days and Work follow the Gantt (not roll-up cells there either)', () => {
    // The same shared rule decides both views
    expect(isSummaryRollupCell({ isSummary: true }, 'duration')).toBe(true);
    expect(isSummaryRollupCell({ isSummary: true }, 'estimatedDays')).toBe(false);
    expect(isSummaryRollupCell({ isSummary: true }, 'estimatedDurationHours')).toBe(false);

    const { cell } = setup('p');
    fireEvent.click(cell('Phase', 'Duration'));
    expect(cell('Phase', 'Duration').querySelector('input')).toBeNull();
    expect(cell('Phase', 'Duration').className).toContain('cursor-default');
    fireEvent.click(cell('Phase', 'Est Days'));
    expect(cell('Phase', 'Est Days').querySelector('input')?.getAttribute('aria-label')).toBe('Estimate (days) for Phase');
  });
});

describe('paste — the same clamp as the Gantt', () => {
  const run = (rules: typeof TABLE_KEYBOARD_RULES, field: string, value: string, task = TASKS[1]) => {
    const onTaskUpdate = vi.fn();
    pasteIntoFocusedCell({
      tasks: TASKS, focusedCell: { taskId: task.id, field }, copiedValue: { field, value },
      rowNumToTaskId: new Map(), onTaskUpdate, flashPaste: () => {}, rules,
    });
    return onTaskUpdate.mock.calls;
  };

  it('a pasted estimate is a number >= 0, sent under the same field name as the Gantt', () => {
    expect(run(TABLE_KEYBOARD_RULES, 'estimatedDays', '-4')).toEqual([['a', { estimatedDays: 0 }]]);
    expect(run(TABLE_KEYBOARD_RULES, 'estimatedDurationHours', '12.5')).toEqual([['a', { estimatedDurationHours: 12.5 }]]);
    for (const f of ['estimatedDays', 'estimatedDurationHours']) {
      for (const v of ['-1', '0', '3', '7.5']) {
        expect(run(TABLE_KEYBOARD_RULES, f, v)).toEqual(run(GANTT_KEYBOARD_RULES, f, v));
      }
    }
  });

  it('pasting into a summary\'s Est Days works as in the Gantt (not a roll-up cell)', () => {
    expect(run(TABLE_KEYBOARD_RULES, 'estimatedDays', '9', TASKS[0])).toEqual([['p', { estimatedDays: 9 }]]);
  });
});

describe('sort — blanks last in both directions', () => {
  const plan: GanttTask[] = [
    { id: 'x', name: 'X', status: 'pending', sortOrder: 1, estimatedDays: 3, estimatedDurationHours: 0 },
    { id: 'y', name: 'Y', status: 'pending', sortOrder: 2 },
    { id: 'z', name: 'Z', status: 'pending', sortOrder: 3, estimatedDays: 0, estimatedDurationHours: 16 },
    { id: 'w', name: 'W', status: 'pending', sortOrder: 4, estimatedDays: 10, estimatedDurationHours: 4.5 },
  ];
  function sortedBy(key: 'estimatedDays' | 'estimatedDurationHours', dir: 'asc' | 'desc') {
    const { result } = renderHook(() => useTableGrouping({
      tasks: plan, cpmMap: new Map(), baselineMap: new Map(), rowNumMap: buildRowNumberMap(plan), resourceNameOf: new Map(),
    }));
    act(() => result.current.toggleSort(key));
    if (dir === 'desc') act(() => result.current.toggleSort(key));
    return result.current.visibleSorted.map(t => t.id);
  }

  it.each([
    ['estimatedDays', ['z', 'x', 'w', 'y'], ['w', 'x', 'z', 'y']],
    ['estimatedDurationHours', ['x', 'w', 'z', 'y'], ['z', 'w', 'x', 'y']],
  ] as const)('%s', (key, asc, desc) => {
    expect(sortedBy(key, 'asc')).toEqual(asc);
    expect(sortedBy(key, 'desc')).toEqual(desc);
  });
});

describe('% complete from approved hours — the same lock as the Gantt', () => {
  it('a Work change sends only the hours; the % lock follows the task\'s progressFromHours answer, before and after', () => {
    const { cell, onTaskUpdate, rerender } = setup('c');
    // Locked: % doesn't open
    fireEvent.click(cell('Check', 'Progress'));
    expect(cell('Check', 'Progress').querySelector('input')).toBeNull();
    // Work still edits, and sends nothing about %
    fireEvent.click(cell('Check', 'Work'));
    const input = cell('Check', 'Work').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '24' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTaskUpdate).toHaveBeenCalledWith('c', { estimatedDurationHours: 24 });
    expect(onTaskUpdate.mock.calls.flatMap(([, d]) => Object.keys(d))).not.toContain('progressPercentage');

    // The saved task comes back with the server's answer: still locked -> still refused
    const saved = TASKS.map(t => (t.id === 'c' ? { ...t, estimatedDurationHours: 24 } : t));
    rerender(saved, 'c');
    fireEvent.click(cell('Check', 'Progress'));
    expect(cell('Check', 'Progress').querySelector('input')).toBeNull();

    // The server says it is no longer from hours -> % opens, as in the Gantt
    rerender(saved.map(t => (t.id === 'c' ? { ...t, progressFromHours: false } : t)), 'c');
    fireEvent.click(cell('Check', 'Progress'));
    expect(cell('Check', 'Progress').querySelector('input')?.getAttribute('aria-label')).toBe('Progress for Check');
  });
});
