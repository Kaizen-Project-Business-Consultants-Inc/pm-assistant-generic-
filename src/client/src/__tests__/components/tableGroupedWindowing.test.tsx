// @vitest-environment happy-dom
/**
 * Table grouped by Status / Priority / Assigned is windowed like the ungrouped Table (2026-10-11
 * speed fix: grouping used to switch windowing off and render every row of a big plan). The body
 * is one flat list of group headings + task rows (useTableGrouping buildTableBodyRows); only the
 * rows on screen (plus overscan) are rendered, and collapsing / expanding a group still works.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import type { GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { buildTableBodyRows } from '../../components/schedule/table/hooks/useTableGrouping';
import { useColumnState } from '../../hooks/useColumnState';

const STATUSES = ['pending', 'in_progress', 'completed'] as const;
const BIG: GanttTask[] = Array.from({ length: 600 }, (_, i) => ({
  id: `t${i}`, name: `Task ${i}`, status: STATUSES[i % 3], startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: i,
}));

function Harness({ tasks }: { tasks: GanttTask[] }) {
  const columnState = useColumnState('s-grouped-window');
  return <TableView tasks={tasks} scheduleId="s-grouped-window" onTaskClick={() => {}} columnState={columnState} />;
}

const mount = (tasks: GanttTask[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><Harness tasks={tasks} /></QueryClientProvider>);
  const groupBy = utils.getByLabelText('Group by') as HTMLSelectElement;
  const taskRows = () => utils.container.querySelectorAll('tbody tr[data-task-id]');
  const groupRow = (label: string) => [...utils.container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(label) && !r.hasAttribute('data-task-id')) as HTMLElement | undefined;
  return { ...utils, groupBy, taskRows, groupRow };
};

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('buildTableBodyRows', () => {
  const tasks = BIG.slice(0, 6);
  it('ungrouped: the tasks in order, row index = position', () => {
    const rows = buildTableBodyRows(tasks, null, new Set());
    expect(rows.map(r => (r.kind === 'task' ? `${r.task.id}@${r.rowIdx}` : r.key))).toEqual(['t0@0', 't1@1', 't2@2', 't3@3', 't4@4', 't5@5']);
  });

  it('grouped: heading then its tasks; a collapsed group shows only its heading but keeps counting row indexes', () => {
    const groups = new Map([['pending', [tasks[0], tasks[3]]], ['in_progress', [tasks[1], tasks[4]]], ['completed', [tasks[2]]]]);
    const rows = buildTableBodyRows(tasks, groups, new Set(['in_progress']));
    expect(rows.map(r => (r.kind === 'task' ? `${r.task.id}@${r.rowIdx}` : `[${r.key} ${r.count}${r.collapsed ? ' closed' : ''}]`))).toEqual([
      '[pending 2]', 't0@0', 't3@1', '[in_progress 2 closed]', '[completed 1]', 't2@4',
    ]);
  });
});

describe('Table grouped: windowed', () => {
  it('ungrouped big plan renders only a window of rows (unchanged)', () => {
    const { taskRows } = mount(BIG);
    expect(taskRows().length).toBeGreaterThan(10);
    expect(taskRows().length).toBeLessThan(100);
  });

  it('grouped big plan renders only a window too, starting with the first group heading', () => {
    const { groupBy, taskRows, groupRow, container } = mount(BIG);
    fireEvent.change(groupBy, { target: { value: 'status' } });
    expect(groupRow('200 tasks')).toBeTruthy();
    expect(taskRows().length).toBeGreaterThan(10);
    expect(taskRows().length).toBeLessThan(100);
    // the rows not on screen are stood in for by a spacer, so the scroll height stays right
    const spacer = container.querySelector('tbody tr[style*="height"]') as HTMLElement;
    expect(spacer).toBeTruthy();
    expect(parseInt(spacer.style.height, 10)).toBeGreaterThan(400 * 35);
  });

  it('collapsing and expanding a group still works', () => {
    const { groupBy, taskRows, groupRow } = mount(BIG);
    fireEvent.change(groupBy, { target: { value: 'status' } });
    const firstId = taskRows()[0].getAttribute('data-task-id');
    expect(firstId).toBe('t0');
    fireEvent.click(groupRow('pending')!);
    // pending's tasks are gone; the next group's heading and tasks move up into the window
    expect([...taskRows()].some(r => BIG[Number(r.getAttribute('data-task-id')!.slice(1))].status === 'pending')).toBe(false);
    expect(groupRow('in progress')).toBeTruthy();
    fireEvent.click(groupRow('pending')!);
    expect(taskRows()[0].getAttribute('data-task-id')).toBe('t0');
  });

  it('a small grouped plan still renders every row', () => {
    const { groupBy, taskRows } = mount(BIG.slice(0, 30));
    fireEvent.change(groupBy, { target: { value: 'status' } });
    expect(taskRows()).toHaveLength(30);
  });
});

/**
 * Review 2026-10-11: grouped, the arrow keys follow the rows as shown (group by group, a collapsed
 * group's tasks skipped), not the plan order — that landed on rows of another group, rows not
 * rendered (windowed) or inside a collapsed group.
 */
describe('Table grouped: the arrow keys follow the rows on screen', () => {
  const keyOn = (target: EventTarget, k: string) => {
    act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
  };
  const onCell = (grid: HTMLElement) => (grid.getAttribute('aria-activedescendant') ?? '').match(/-cell-(t\d+)-name$/)?.[1];

  it('ArrowDown goes to the next task in the same group, then into the next open group', () => {
    const { groupBy, groupRow, container } = mount(BIG.slice(0, 6)); // t0,t3 pending · t1,t4 in progress · t2,t5 completed
    fireEvent.change(groupBy, { target: { value: 'status' } });
    const grid = container.querySelector('[role="treegrid"]') as HTMLElement;
    act(() => { grid.focus(); });
    expect(onCell(grid)).toBe('t0');
    keyOn(grid, 'ArrowDown');
    expect(onCell(grid)).toBe('t3'); // not t1 (plan order)
    keyOn(grid, 'ArrowDown');
    expect(onCell(grid)).toBe('t1');
    keyOn(grid, 'ArrowUp');
    keyOn(grid, 'ArrowUp');
    expect(onCell(grid)).toBe('t0');
    fireEvent.click(groupRow('in progress')!); // collapse: its tasks are skipped
    act(() => { grid.focus(); });
    keyOn(grid, 'ArrowDown');
    expect(onCell(grid)).toBe('t3');
    keyOn(grid, 'ArrowDown');
    expect(onCell(grid)).toBe('t2');
  });
});
