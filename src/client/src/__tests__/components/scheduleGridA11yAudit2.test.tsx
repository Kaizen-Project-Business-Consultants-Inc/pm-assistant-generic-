// @vitest-environment happy-dom
/**
 * Schedule grid accessibility, audit 2 (part 6) — the Gantt grid and the Table:
 * - H10: Table / Gantt headers sort from a real button (aria-sort on the header); the hover-only
 *   "move column" arrows are out of the Tab order and out of the header's name, and say which
 *   column they move; the last header says "Actions".
 * - M2: zoom, layout and quick-filter toggles say which one is on (aria-pressed), zoom by name.
 * - M3: both grids are treegrids: rows carry their true position (aria-rowindex, also when the
 *   grouped Table is windowed), level, open / closed and selected; the Gantt's row content sits in
 *   grid cells; the collapse button names its task.
 * - M4: after a row delete, a bulk change or a cell edit, the focus is back on the grid (not <body>).
 * - Table group headings open / close from a button with aria-expanded (Tab reaches it).
 * - Row drag: by task id; switched off while grouped (no plan position between two grouped rows).
 * - L4 / L6: locked cells and the Kanban / task form text keep 4.5:1 in dark mode.
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'fs';
import path from 'path';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { GanttToolbar } from '../../components/schedule/gantt/GanttToolbar';
import { QuickFilterPills } from '../../pages/ProjectDetailPage/schedule-tab/QuickFilterPills';
import { buildTableBodyRows } from '../../components/schedule/table/hooks/useTableGrouping';
import { planRowDrop } from '../../components/schedule/table/rowDrop';
import { rowAfterRemoval } from '../../components/schedule/shared/gridFocus';
import { useColumnState } from '../../hooks/useColumnState';

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'Alpha', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20 },
  { id: 'b', name: 'Bravo', status: 'completed', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30 },
  { id: 'c', name: 'Charlie', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 40 },
];

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={qc()}>{ui}</QueryClientProvider>);

type TableProps = Partial<React.ComponentProps<typeof TableView>> & { tasks?: GanttTask[] };
function Table({ tasks = TASKS, ...rest }: TableProps) {
  const columnState = useColumnState('s-a11y-audit2');
  return <TableView tasks={tasks} scheduleId="s-a11y-audit2" onTaskClick={() => {}} columnState={columnState} {...rest} />;
}
const grid = (c: HTMLElement) => c.querySelector('[role="treegrid"]') as HTMLElement;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

describe('H10: Table header — sort by keyboard, move arrows out of the way', () => {
  it('each sortable header holds a real sort button; aria-sort follows it', () => {
    const { container } = wrap(<Table onTaskUpdate={() => {}} />);
    const th = [...container.querySelectorAll('thead th')].find(h => h.querySelector('button:not([tabindex="-1"])')?.textContent === 'Task Name') as HTMLElement;
    expect(th).toBeTruthy();
    expect(th.getAttribute('aria-sort')).toBe('none');
    const sort = within(th).getByRole('button', { name: 'Task Name' });
    expect(sort.tagName).toBe('BUTTON');
    expect(sort.getAttribute('tabindex')).toBeNull(); // in the Tab order
    fireEvent.click(sort);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
  });

  it('the move arrows are hidden from screen readers and Tab, and say which column they move', () => {
    const { container } = wrap(<Table onTaskUpdate={() => {}} />);
    const th = [...container.querySelectorAll('thead th')].find(h => h.textContent?.includes('Task Name')) as HTMLElement;
    const arrows = th.querySelectorAll('button[tabindex="-1"]');
    expect(arrows.length).toBe(2);
    for (const b of arrows) expect(b.closest('[aria-hidden="true"]')).not.toBeNull();
    expect([...arrows].map(b => b.getAttribute('title'))).toEqual(['Move Task Name column left', 'Move Task Name column right']);
    // the header's accessible name is just the column (role queries skip aria-hidden content)
    expect(within(th).getAllByRole('button').map(b => b.textContent)).toEqual(['Task Name']);
  });

  it('the last header is named "Actions" for screen readers', () => {
    const { container } = wrap(<Table onTaskUpdate={() => {}} />);
    const ths = container.querySelectorAll('thead th');
    expect(ths[ths.length - 1].textContent).toBe('Actions');
  });

  it('Gantt header: sort is a button too; the move arrows are aria-hidden and out of Tab', () => {
    const { container } = wrap(<GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s-h10" onTaskUpdate={() => {}} onTaskClick={() => {}} />);
    const start = [...container.querySelectorAll('[role="columnheader"]')].find(h => h.textContent?.includes('Start')) as HTMLElement;
    expect(within(start).getByRole('button', { name: 'Start' }).tagName).toBe('BUTTON');
    for (const b of start.querySelectorAll('button[tabindex="-1"]')) expect(b.closest('[aria-hidden="true"]')).not.toBeNull();
    const headers = [...container.querySelectorAll('[role="columnheader"]')];
    expect(headers[headers.length - 1].textContent).toBe('Actions');
  });
});

describe('M2: toggle groups say which option is on', () => {
  function toolbar(zoom: 'day' | 'week' | 'month', panelMode: 'table' | 'split' | 'gantt') {
    return render(
      <GanttToolbar
        scheduleName="Plan" onAddTask={() => {}} rowCount={3} baseRowCount={3} parentTaskCount={0} collapsedCount={0}
        expandAll={() => {}} collapseAll={() => {}} zoom={zoom} setZoom={() => {}} handleZoomToFit={() => {}}
        searchQuery="" setSearchQuery={() => {}} searchInputRef={createRef<HTMLInputElement>()} showFilters={false}
        setShowFilters={() => {}} activeFilterCount={0} setPendingDeleteIds={() => {}} orderedColumns={[]}
        ganttVisibleCols={new Set()} toggleColVisibility={() => {}} moveColumn={() => {}} setGanttVisibleCols={() => {}}
        setGanttColOrder={() => {}} tasks={[]} showOverallocation={false} setShowOverallocation={() => {}}
        overallocatedCount={0} showTimeline={false} setShowTimeline={() => {}} handleLoadView={() => {}}
        panelMode={panelMode} setPanelMode={() => {}} sortField={null} sortDirection={null}
      />,
    );
  }

  it('Gantt zoom: named buttons (Day, Week, …), the current one pressed', () => {
    const r = toolbar('week', 'split');
    const zoom = r.getByRole('group', { name: 'Zoom' });
    expect(within(zoom).getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(zoom).getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(zoom).getAllByRole('button', { pressed: true }).length).toBe(1);
  });

  it('Gantt layout: Table only / Split view / Gantt only, the current one pressed', () => {
    const r = toolbar('day', 'gantt');
    const layout = r.getByRole('group', { name: 'Layout' });
    expect(within(layout).getByRole('button', { name: 'Gantt only' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(layout).getByRole('button', { name: 'Split view' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Quick filters: a group of pressed / not-pressed buttons (no tablist without panels)', () => {
    const counts = { all: 4, due: 1, late: 2, at_risk: 0, my_tasks: 1, unassigned: 0 };
    const onFilterChange = vi.fn();
    const r = render(<QuickFilterPills activeFilter="late" onFilterChange={onFilterChange} dueWeeks={1} onDueWeeksChange={() => {}}
      counts={counts} thresholds={{ atRiskProgressGap: 20, atRiskDaysBeforeEnd: 3 } as never} onThresholdsChange={() => {}} />);
    expect(r.queryByRole('tablist')).toBeNull();
    const group = r.getByRole('group', { name: 'Quick filters' });
    expect(within(group).getByRole('button', { name: /^Late/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: /^All/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(group).getByRole('button', { name: /^My Tasks/ }));
    expect(onFilterChange).toHaveBeenCalledWith('my_tasks');
  });
});

describe('M3: treegrid semantics', () => {
  it('Table: treegrid with a row count; rows carry index, level, open / closed and selected', () => {
    const { container } = wrap(<Table onTaskUpdate={() => {}} activeTaskId="a" />);
    const g = grid(container);
    expect(g.tagName).toBe('TABLE');
    expect(g.getAttribute('aria-rowcount')).toBe(String(1 + TASKS.length));
    const row = (id: string) => container.querySelector(`tr[data-task-id="${id}"]`) as HTMLElement;
    expect(container.querySelector('thead tr')!.getAttribute('aria-rowindex')).toBe('1');
    expect(['p', 'a', 'b', 'c'].map(id => row(id).getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5']);
    expect(row('p').getAttribute('aria-level')).toBe('1');
    expect(row('a').getAttribute('aria-level')).toBe('2');
    expect(row('p').getAttribute('aria-expanded')).toBe('true');
    expect(row('a').hasAttribute('aria-expanded')).toBe(false);
    // selected = in the multi-selection; the active (current) row alone is not selected (review)
    expect(row('a').getAttribute('aria-selected')).toBe('false');
    expect(row('b').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(within(row('b')).getByRole('checkbox'));
    expect(row('b').getAttribute('aria-selected')).toBe('true');
    expect(row('a').getAttribute('aria-selected')).toBe('false');
    const collapse = within(row('p')).getByRole('button', { name: 'Collapse Phase' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(collapse);
    expect(row('p').getAttribute('aria-expanded')).toBe('false');
    expect(within(row('p')).getByRole('button', { name: 'Expand Phase' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('Gantt: treegrid; each row\'s content sits in grid cells; rows carry index, level, open / closed and selected', () => {
    const { container } = wrap(<GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s-m3" activeTaskId="b" onTaskUpdate={() => {}} onBulkUpdate={async () => {}} onTaskClick={() => {}} onDeleteTask={() => {}} />);
    const g = grid(container);
    expect(g.getAttribute('aria-label')).toBe('Task list');
    const rows = [...g.querySelectorAll('[role="row"][data-task-id]')] as HTMLElement[];
    expect(rows.length).toBe(4);
    for (const r of rows) {
      for (const child of r.children) expect(['gridcell', 'rowheader']).toContain(child.getAttribute('role'));
    }
    expect(rows.map(r => r.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5']);
    expect(g.getAttribute('aria-rowcount')).toBe('5');
    const byId = (id: string) => rows.find(r => r.dataset.taskId === id)!;
    expect(byId('p').getAttribute('aria-expanded')).toBe('true');
    expect(byId('a').getAttribute('aria-level')).toBe('2');
    expect(byId('b').getAttribute('aria-selected')).toBe('false'); // active, not selected (review)
    fireEvent.click(byId('c'), { ctrlKey: true });
    expect(byId('c').getAttribute('aria-selected')).toBe('true'); // Ctrl+click: the active row joins the selection
    expect(byId('a').getAttribute('aria-selected')).toBe('false');
    expect(within(byId('p')).getByRole('button', { name: 'Collapse Phase' }).getAttribute('aria-expanded')).toBe('true');
    // the row actions name their task and show on keyboard focus
    const del = within(byId('a')).getByRole('button', { name: 'Delete Alpha' });
    expect(del.className).toContain('focus-visible:opacity-100');
  });

  it('Table row actions name their task and show while the row has keyboard focus', () => {
    const { container } = wrap(<Table onTaskUpdate={() => {}} onInsertAfter={() => {}} />);
    const row = container.querySelector('tr[data-task-id="a"]') as HTMLElement;
    for (const name of ['Edit Alpha', 'Insert a task below Alpha', 'Delete Alpha']) {
      const b = within(row).getByRole('button', { name });
      expect(b.parentElement!.className).toContain('group-focus-within:opacity-100');
    }
  });

  it('grouped and windowed Table: every rendered row carries its true position, also after scrolling', () => {
    const STATUSES = ['pending', 'in_progress', 'completed'] as const;
    const big: GanttTask[] = Array.from({ length: 600 }, (_, i) => ({
      id: `t${i}`, name: `Task ${i}`, status: STATUSES[i % 3], startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: i,
    }));
    const { container, getByLabelText } = wrap(<Table tasks={big} />);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    // what the body is, in order: 3 headings + 600 tasks
    const groups = new Map<string, GanttTask[]>();
    for (const t of big) { if (!groups.has(t.status)) groups.set(t.status, []); groups.get(t.status)!.push(t); }
    const body = buildTableBodyRows(big, groups, new Set());
    const keyOf = (r: (typeof body)[number]) => (r.kind === 'task' ? r.task.id : `group-${r.key}`);
    const expectedIndex = new Map(body.map((r, i) => [keyOf(r), String(i + 2)]));
    const check = () => {
      const rendered = [...container.querySelectorAll('tbody tr[aria-rowindex]')] as HTMLElement[];
      expect(rendered.length).toBeGreaterThan(10);
      for (const tr of rendered) {
        const key = tr.dataset.taskId ?? `group-${tr.textContent?.match(/^\s*([a-z ]+?)\s*\d+ tasks?/i)?.[1].replace(/ /g, '_')}`;
        expect(tr.getAttribute('aria-rowindex'), key).toBe(expectedIndex.get(key));
      }
      return rendered;
    };
    expect(grid(container).getAttribute('aria-rowcount')).toBe(String(1 + body.length));
    check();
    const scroller = container.querySelector('div.overflow-y-auto') as HTMLElement;
    act(() => { scroller.scrollTop = 300 * 35; fireEvent.scroll(scroller); });
    const after = check();
    expect(Number(after[0].getAttribute('aria-rowindex'))).toBeGreaterThan(200);
    // the spacer rows that stand in for the rows not on screen are not rows to a screen reader
    for (const sp of container.querySelectorAll('tbody tr[style*="height"]')) expect(sp.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Table group headings: a button with aria-expanded', () => {
  it('Tab reaches the heading button; it opens and closes the group', () => {
    const { container, getByLabelText } = wrap(<Table onTaskUpdate={() => {}} />);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    const heading = [...container.querySelectorAll('tbody tr')].find(r => !r.hasAttribute('data-task-id') && /pending/i.test(r.textContent ?? '')) as HTMLElement;
    const btn = within(heading).getByRole('button', { name: /pending\s*3 tasks/i });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    expect(heading.getAttribute('aria-level')).toBe('1');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('tr[data-task-id="a"]')).toBeNull();
    fireEvent.click(btn);
    expect(container.querySelector('tr[data-task-id="a"]')).not.toBeNull();
    // tasks in a group sit one level under the heading, all at the same level (the plan's outline
    // is not shown across groups; review)
    for (const id of ['p', 'a', 'b', 'c']) expect(container.querySelector(`tr[data-task-id="${id}"]`)!.getAttribute('aria-level')).toBe('2');
  });
});

describe('Row drag (data bug): tasks by id, and no drag while grouped', () => {
  const rows: GanttTask[] = [
    { id: 'a', name: 'A', status: 'pending', sortOrder: 10 },
    { id: 'b', name: 'B', status: 'pending', sortOrder: 20 },
    { id: 'c', name: 'C', status: 'pending', sortOrder: 30 },
    { id: 'd', name: 'D', status: 'pending', sortOrder: 40 },
  ];
  const none = () => new Set<string>();
  const order = (u: ReturnType<typeof planRowDrop>) => u!.map(x => x.taskId).join('');

  it('dragging down drops below the target; up, above it — by id, whatever the rows\' positions on screen', () => {
    expect(order(planRowDrop(rows, 'a', 'c', none))).toBe('bcad');
    expect(order(planRowDrop(rows, 'd', 'b', none))).toBe('adbc');
    expect(planRowDrop(rows, 'b', 'b', none)).toBeNull();
    expect(planRowDrop(rows, 'b', 'gone', none)).toBeNull();
  });

  it('the dragged task is the one that moves (its subtasks with it); not onto its own subtask', () => {
    const tree: GanttTask[] = [
      { id: 'p', name: 'P', status: 'pending', sortOrder: 10 },
      { id: 'k', name: 'K', status: 'pending', parentTaskId: 'p', sortOrder: 20 },
      { id: 'x', name: 'X', status: 'pending', sortOrder: 30 },
    ];
    const kids = (id: string) => new Set(tree.filter(t => t.parentTaskId === id).map(t => t.id));
    expect(order(planRowDrop(tree, 'p', 'x', kids))).toBe('xpk');
    expect(planRowDrop(tree, 'p', 'k', kids)).toBeNull();
  });

  it('in the Table, a drag from row A to row C moves A (the rows are found by their task id)', () => {
    const onTaskReorder = vi.fn();
    const { container } = wrap(<Table tasks={rows} onTaskUpdate={() => {}} onTaskReorder={onTaskReorder} />);
    const trs = [...container.querySelectorAll('tbody tr[data-task-id]')] as HTMLElement[];
    trs.forEach((tr, i) => {
      tr.getBoundingClientRect = () => ({ left: 0, right: 800, top: i * 30, bottom: i * 30 + 30, width: 800, height: 30, x: 0, y: i * 30, toJSON: () => ({}) });
    });
    const grip = trs[0].querySelector('[title="Drag to reorder"]') as HTMLElement;
    fireEvent.mouseDown(grip, { clientX: 5, clientY: 15 });
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 75, bubbles: true })); });
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', { clientX: 5, clientY: 75, bubbles: true })); });
    expect(onTaskReorder).toHaveBeenCalledTimes(1);
    expect(order(onTaskReorder.mock.calls[0][0])).toBe('bcad');
  });

  it('grouped: no drag handle (a grouped order has no place in the plan to drop between)', () => {
    const { container, getByLabelText } = wrap(<Table tasks={rows} onTaskUpdate={() => {}} onTaskReorder={() => {}} />);
    expect(container.querySelectorAll('[title="Drag to reorder"]').length).toBe(4);
    fireEvent.change(getByLabelText('Group by'), { target: { value: 'status' } });
    expect(container.querySelectorAll('[title="Drag to reorder"]').length).toBe(0);
  });
});

describe('M4: the focus stays in the grid after common actions', () => {
  it('rowAfterRemoval: the next row that stays, else the one before', () => {
    const r = ['a', 'b', 'c', 'd'].map(id => ({ id }));
    expect(rowAfterRemoval(r, new Set(['b']))).toBe('c');
    expect(rowAfterRemoval(r, new Set(['b', 'c']))).toBe('d');
    expect(rowAfterRemoval(r, new Set(['d']))).toBe('c');
    expect(rowAfterRemoval(r, new Set(['a', 'b', 'c', 'd']))).toBeNull();
  });

  it('Table: after a row\'s Delete is confirmed, the focus is on the grid, on the next row', async () => {
    const onBulkDelete = vi.fn(async () => {});
    const { container, getByRole } = wrap(<Table onTaskUpdate={() => {}} onBulkDelete={onBulkDelete} />);
    const del = within(container.querySelector('tr[data-task-id="a"]') as HTMLElement).getByRole('button', { name: 'Delete Alpha' });
    del.focus();
    fireEvent.click(del);
    await act(async () => { fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Delete' })); });
    expect(onBulkDelete).toHaveBeenCalledWith(['a']);
    const g = grid(container);
    await waitFor(() => expect(document.activeElement).toBe(g));
    await waitFor(() => expect(g.getAttribute('aria-activedescendant') ?? '').toMatch(/-cell-b-name$/));
  });

  it('Gantt: after a bulk delete is confirmed, the focus is on the grid, on the row after', async () => {
    const onBulkDelete = vi.fn(async () => {});
    const { container, getByRole } = wrap(<GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s-m4" activeTaskId="a"
      onTaskUpdate={() => {}} onBulkUpdate={async () => {}} onBulkDelete={onBulkDelete} onTaskClick={() => {}} onDeleteTask={() => {}} />);
    const del = within(container.querySelector('[role="row"][data-task-id="a"]') as HTMLElement).getByRole('button', { name: 'Delete Alpha' });
    fireEvent.click(del);
    await act(async () => { fireEvent.click(within(getByRole('dialog')).getByRole('button', { name: 'Delete' })); });
    expect(onBulkDelete).toHaveBeenCalledWith(['a']);
    const g = grid(container);
    await waitFor(() => expect(document.activeElement).toBe(g));
    await waitFor(() => expect(g.getAttribute('aria-activedescendant') ?? '').toMatch(/-cell-b-name$/));
  });

  it('Table: a cell edit started with the mouse and saved with Enter leaves the focus on the grid', () => {
    const onTaskUpdate = vi.fn();
    const { container } = wrap(<Table onTaskUpdate={onTaskUpdate} activeTaskId="c" />);
    const g = grid(container);
    const nameCell = container.querySelector('tr[data-task-id="c"] td[role="rowheader"]') as HTMLElement;
    fireEvent.mouseDown(nameCell);
    fireEvent.click(nameCell);
    const input = within(nameCell).getByRole('textbox');
    act(() => { input.focus(); });
    fireEvent.change(input, { target: { value: 'Charlie 2' } });
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(onTaskUpdate).toHaveBeenCalled();
    expect(within(nameCell).queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(g);
  });
});

describe('L4 / L6: readable colours in dark mode', () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

  it('locked grid cells use a colour, not opacity (Gantt grid and Table)', () => {
    for (const f of ['components/schedule/TableView.tsx', 'components/schedule/gantt/GanttLeftPanelRow.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/cursor-default opacity-70/);
      expect(src, f).toMatch(/cursor-default !text-gray-600 dark:!text-gray-400/);
    }
  });

  it('Kanban and the task form: no dark grey text or placeholders under 4.5:1; red text has a dark colour', () => {
    for (const f of ['components/schedule/KanbanBoard.tsx', 'components/schedule/TaskFormModal.tsx']) {
      const src = read(f);
      expect(src.match(/dark:(text|placeholder)-gray-[5-9]00\b/g) ?? [], f).toEqual([]);
      src.split('\n').forEach((line, i) => {
        if (/\btext-red-[4-6]00\b/.test(line)) expect(line, `${f}:${i + 1}`).toMatch(/dark:text-red-/);
      });
    }
    // Cards are gray-700 in dark mode: their grey text is gray-300 (gray-400 there is 4.0:1)
    const kanban = read('components/schedule/KanbanBoard.tsx');
    const card = kanban.slice(kanban.indexOf('const KanbanCard'), kanban.indexOf('const KanbanLaneCard'));
    expect(card).not.toMatch(/dark:text-gray-400/);
    expect(card).toMatch(/dark:text-red-300/);
  });

  it('the Undo message: not an alert, Ctrl+Z said as the shortcut, a readable hint', () => {
    const src = read('pages/ProjectDetailPage/schedule-tab/ScheduleWorkspace.tsx');
    const toast = src.slice(src.indexOf('{/* Undo toast'), src.indexOf('{/* A save that failed'));
    expect(toast).not.toMatch(/role="alert"/);
    expect(toast).toMatch(/aria-keyshortcuts="Control\+Z"/);
    expect(toast).toMatch(/onMouseEnter=\{\(\) => holdUndoToast\(true\)\}/);
    expect(toast).toMatch(/text-gray-300 text-xs" aria-hidden="true">Ctrl\+Z/);
  });
});
