/**
 * Code-health item 4, phase 4 (2026-10-05): the Gantt's left grid panel and right timeline
 * panel moved out of GanttChart.tsx into gantt/GanttGridPanel.tsx and gantt/GanttTimelinePanel.tsx.
 * The move must not change a single element, class, attribute or their order, so this renders
 * GanttChart in several states and compares the whole container.innerHTML, byte for byte, with
 * fixtures captured on the commit BEFORE the move (origin/master 51a8eeb8).
 *
 * To re-capture (only ever on a commit whose DOM is known good): GANTT_DOM_WRITE=1 npx vitest run ganttChartDom
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const api = vi.hoisted(() => ({
  getResources: vi.fn(async () => ({ resources: [
    { id: 'r1', name: 'Pat Manager', role: 'PM' },
    { id: 'r2', name: 'Sam Builder', role: 'Developer' },
  ] })),
  getGlobalResourceWorkload: vi.fn(async () => ({ workload: [] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';

const FIXTURES = join(__dirname, '__fixtures__', 'ganttChartDom');
const WRITE = process.env.GANTT_DOM_WRITE === '1';

function expectSameDom(name: string, html: string) {
  const file = join(FIXTURES, `${name}.html`);
  if (WRITE) {
    if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, html, 'utf8');
    return;
  }
  const expected = readFileSync(file, 'utf8');
  // byte-identical; on a mismatch, report the first differing offset for a readable failure
  if (html !== expected) {
    let i = 0;
    while (i < html.length && html[i] === expected[i]) i++;
    expect({ at: i, got: html.slice(Math.max(0, i - 120), i + 120) })
      .toEqual({ at: i, got: expected.slice(Math.max(0, i - 120), i + 120) });
  }
  expect(html).toBe(expected);
}

// A realistic plan: a summary with children, a nested summary, a milestone, FS/SS links with lag,
// an unscheduled task, assignees, a baseline that moved, critical path, float, risk, review flag.
const TASKS: GanttTask[] = [
  { id: 't1', name: 'Discovery', status: 'completed', priority: 'high', startDate: '2026-03-02', endDate: '2026-03-20', progressPercentage: 100, sortOrder: 10, isSummary: true },
  { id: 't2', name: 'Stakeholder interviews', status: 'completed', priority: 'medium', startDate: '2026-03-02', endDate: '2026-03-06', progressPercentage: 100, parentTaskId: 't1', assignedTo: 'r1', estimatedDays: 5, estimatedDurationHours: 40, sortOrder: 20 },
  { id: 't3', name: 'Requirements doc', status: 'in_progress', priority: 'high', startDate: '2026-03-09', endDate: '2026-03-20', progressPercentage: 40, parentTaskId: 't1', assignedTo: 'r2', sortOrder: 30,
    dependencies: [{ dependencyId: 't2', dependencyType: 'FS', lagDays: 0 }] },
  { id: 't4', name: 'Build', status: 'pending', priority: 'medium', startDate: '2026-03-23', endDate: '2026-04-24', progressPercentage: 0, sortOrder: 40, isSummary: true },
  { id: 't5', name: 'Backend', status: 'pending', priority: 'urgent', startDate: '2026-03-23', endDate: '2026-04-10', parentTaskId: 't4', assignedTo: 'r2', sortOrder: 50,
    dependencies: [{ dependencyId: 't3', dependencyType: 'FS', lagDays: 1 }], description: 'API + DB' },
  { id: 't6', name: 'Frontend', status: 'blocked', priority: 'low', startDate: '2026-03-30', endDate: '2026-04-24', parentTaskId: 't4', sortOrder: 60,
    dependencies: [{ dependencyId: 't5', dependencyType: 'SS', lagDays: 5 }] },
  { id: 't7', name: 'Go-live', status: 'pending', startDate: '2026-04-27', endDate: '2026-04-27', isMilestone: true, sortOrder: 70,
    dependencies: [{ dependencyId: 't6', dependencyType: 'FS', lagDays: 0 }] },
  { id: 't8', name: 'Unscheduled idea', status: 'pending', sortOrder: 80 },
];

const baseProps = () => ({
  tasks: TASKS,
  scheduleName: 'Website relaunch',
  scheduleId: 's1',
  activeTaskId: 't3',
  onTaskClick: vi.fn(),
  onTaskSelect: vi.fn(),
  onAddTask: vi.fn(),
  onQuickAdd: vi.fn(),
  onDeleteTask: vi.fn(),
  criticalPathTaskIds: ['t2', 't3', 't5'],
  taskFloatMap: { t6: 3, t7: 0 },
  baselineTasks: [{ taskId: 't5', startDate: '2026-03-16', endDate: '2026-04-03' }, { taskId: 't2', startDate: '2026-03-02', endDate: '2026-03-06' }],
  onTaskDragEnd: vi.fn(),
  onTaskUpdate: vi.fn(),
  onTaskReorder: vi.fn(),
  onBulkUpdate: vi.fn(async () => {}),
  onBulkDelete: vi.fn(async () => {}),
  canUndo: true,
  undoDescription: 'Move Backend',
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onCreateTaskWithDates: vi.fn(),
  onInsertAfter: vi.fn(),
  onInsertBefore: vi.fn(),
  onInlineInsert: vi.fn(),
  onInlineInsertBefore: vi.fn(),
  taskRiskMap: new Map([['t6', 'high' as const]]) as never,
  reviewFlagMap: new Map([['t6', 'Blocked task with successors']]),
  highlightTaskIds: new Set(['t5']),
  onOpenReview: vi.fn(),
  onOpenCalendar: vi.fn(),
});

type Props = Parameters<typeof GanttChart>[0];

async function renderGantt(props: Props) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><GanttChart {...props} /></QueryClientProvider>);
  await settle();
  return utils;
}

let qc: QueryClient;

/** let the resource queries resolve and effects run (waits for every query, so a slow machine
 *  can't capture a half-loaded page) */
async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  await waitFor(() => expect(qc.isFetching()).toBe(0));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); });

describe('GanttChart DOM is byte-identical to the pre-split capture', () => {
  it('split view, month zoom, every overlay on', async () => {
    const { container } = await renderGantt(baseProps());
    expectSameDom('split-month', container.innerHTML);
  });

  it('week zoom, non-working days shaded, a summary collapsed, filtered list, Timeline strip on', async () => {
    localStorage.setItem('gantt-zoom:s1', 'week');
    localStorage.setItem('gantt-collapsed:s1', JSON.stringify(['t1']));
    localStorage.setItem('gantt-show-timeline', '1');
    const p = baseProps();
    const filtered = TASKS.filter(t => t.id !== 't6');
    const { container } = await renderGantt({
      ...p, tasks: filtered, allTasks: TASKS, onQuickAdd: undefined, activeTaskId: null,
      nonWorkingDates: new Set(['2026-03-14', '2026-03-15', '2026-03-21', '2026-03-22', '2026-04-03']),
      workCalendar: null,
    });
    expectSameDom('week-collapsed-filtered', container.innerHTML);
  });

  it('read-only (no handlers) at day zoom', async () => {
    localStorage.setItem('gantt-zoom:s1', 'day');
    const { container } = await renderGantt({ tasks: TASKS, scheduleName: 'Read only', scheduleId: 's1' });
    expectSameDom('readonly-day', container.innerHTML);
  });

  it('inline insert rows (after, then before) and the bar drag state', async () => {
    const { container, getAllByTitle, getByText } = await renderGantt(baseProps());
    // insert-after from the row's + button
    fireEvent.click(getAllByTitle('Insert task below')[1]);
    await settle();
    expectSameDom('inline-insert-after', container.innerHTML);
    // insert-before from the context menu
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await settle();
    const row = container.querySelector('[data-task-id="t5"]')!;
    fireEvent.contextMenu(row, { clientX: 50, clientY: 60 });
    await settle();
    expectSameDom('context-menu', container.innerHTML);
    fireEvent.click(getByText('Insert Task Above'));
    await settle();
    expectSameDom('inline-insert-before', container.innerHTML);
  });

  it('table-only and gantt-only modes', async () => {
    const { container, getByTitle } = await renderGantt(baseProps());
    fireEvent.click(getByTitle('Table only'));
    await settle();
    expectSameDom('mode-table', container.innerHTML);
    fireEvent.click(getByTitle('Gantt only'));
    await settle();
    expectSameDom('mode-gantt', container.innerHTML);
  });

  it('virtualised (over 100 rows), bulk selection on', async () => {
    const many: GanttTask[] = Array.from({ length: 120 }, (_, i) => ({
      id: `v${i}`, name: `Task ${i + 1}`, status: i % 3 === 0 ? 'completed' : 'pending',
      startDate: `2026-03-${String(2 + (i % 20)).padStart(2, '0')}`, endDate: `2026-04-${String(1 + (i % 25)).padStart(2, '0')}`,
      sortOrder: (i + 1) * 10,
      dependencies: i > 0 && i % 7 === 0 ? [{ dependencyId: `v${i - 1}`, dependencyType: 'FS', lagDays: 0 }] : undefined,
    }));
    const { container } = await renderGantt({ ...baseProps(), tasks: many, activeTaskId: 'v2', highlightTaskIds: undefined });
    const rows = container.querySelectorAll('[role="row"][data-task-id]');
    fireEvent.click(rows[0], { ctrlKey: true });
    await settle();
    expectSameDom('virtualised-selected', container.innerHTML);
  });

  it('mid-gesture: bar drag, link drawing, drag-to-create', async () => {
    const p = baseProps();
    const { container } = await renderGantt(p);
    const bars = () => Array.from(container.querySelectorAll<HTMLElement>('.group\\/bar')).filter(el => el.style.cursor === 'grab');
    // bar being dragged
    fireEvent.mouseDown(bars()[0], { clientX: 100, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 160, clientY: 10 });
    await settle();
    expectSameDom('gesture-bar-drag', container.innerHTML);
    fireEvent.mouseUp(document, { clientX: 160, clientY: 10 });
    await settle();
    // a link being drawn from a bar's finish dot
    const dot = container.querySelector<HTMLElement>('[title="Drag to create dependency (Finish)"]')!;
    fireEvent.mouseDown(dot, { clientX: 200, clientY: 120 });
    fireEvent.mouseMove(document, { clientX: 260, clientY: 150 });
    await settle();
    expectSameDom('gesture-link-draw', container.innerHTML);
    fireEvent.mouseUp(document, { clientX: 260, clientY: 150 });
    await settle();
    // drag-to-create on an empty part of the timeline
    const canvas = container.querySelector<HTMLElement>('#gantt-print-container > div.relative > div.flex-1 > div')!;
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 52 + 36 * 2 + 5 });
    fireEvent.mouseMove(document, { clientX: 420, clientY: 52 + 36 * 2 + 5 });
    await settle();
    expectSameDom('gesture-create-drag', container.innerHTML);
    fireEvent.mouseUp(document, { clientX: 420, clientY: 52 + 36 * 2 + 5 });
    await settle();
  });
});

describe('GanttChart handlers still reach the same callbacks', () => {
  it('a row click selects the task; a row double-click opens it', async () => {
    const p = baseProps();
    const { container } = await renderGantt(p);
    const row = container.querySelector('[data-task-id="t5"]')!;
    fireEvent.click(row);
    expect(p.onTaskSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't5' }));
    fireEvent.doubleClick(row);
    expect(p.onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ id: 't5' }));
  });

  it('a cell click on the active row starts editing; double-click on a cell opens the task', async () => {
    const p = baseProps();
    const { container } = await renderGantt(p);
    const row = container.querySelector('[data-task-id="t3"]')!; // t3 is active
    const nameCell = row.querySelectorAll(':scope > div')[1] as HTMLElement;
    fireEvent.click(nameCell);
    await settle();
    expect(row.querySelector('input')).toBeTruthy();
    fireEvent.keyDown(row.querySelector('input')!, { key: 'Escape' });
    await settle();
    fireEvent.doubleClick(row.querySelectorAll(':scope > div')[2] as HTMLElement);
    expect(p.onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ id: 't3' }));
  });

  it('a bar mousedown starts a drag (timeline shows grabbing) and a move + release reschedules', async () => {
    const p = baseProps();
    const { container } = await renderGantt(p);
    const bar = Array.from(container.querySelectorAll<HTMLElement>('.group\\/bar'))
      .find(el => el.style.cursor === 'grab')!;
    expect(bar).toBeTruthy();
    fireEvent.mouseDown(bar, { clientX: 100, clientY: 10 });
    await settle();
    const timeline = container.querySelector<HTMLElement>('#gantt-print-container > div.relative > div.flex-1')!;
    expect(timeline.style.cursor).toBe('grabbing');
    fireEvent.mouseMove(document, { clientX: 400, clientY: 10 });
    fireEvent.mouseUp(document, { clientX: 400, clientY: 10 });
    await settle();
    expect(p.onTaskDragEnd).toHaveBeenCalled();
    expect(timeline.style.cursor).toBe('crosshair');
  });

  it('typing a name into the inline insert row creates the task after that row', async () => {
    const p = baseProps();
    const { getAllByTitle, getByPlaceholderText } = await renderGantt(p);
    fireEvent.click(getAllByTitle('Insert task below')[1]);
    await settle();
    const input = getByPlaceholderText('Type task name and press Enter…') as HTMLInputElement;
    input.value = 'New step';
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onInlineInsert).toHaveBeenCalledWith('New step', 't2', 't1');
  });
});
