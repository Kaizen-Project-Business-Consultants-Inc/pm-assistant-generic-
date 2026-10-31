// @vitest-environment happy-dom
/**
 * Gantt and Table share one look (user-approved mock, 2026-10-31):
 *  - Gantt: a checkbox on every row beside the row number (it used to appear only after one row was
 *    ticked); the header box selects all; Shift+click ticks a range; no box where bulk changes are not allowed.
 *  - Table: one line per row at the Gantt's row height, names cut with "…" and the full name on hover,
 *    short dates in the Gantt's format (the year only when it is not this year), centred small numbers.
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: (_t, k) => (k === 'getResources' ? vi.fn(async () => ({ resources: [] })) : vi.fn(async () => ({}))) }),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { ROW_H } from '../../components/schedule/gantt/types';
import { formatDate } from '../../components/schedule/table/types';
import { useColumnState } from '../../hooks/useColumnState';

const LONG = 'Desk Review Findings & Inception Report / Master Work Plan with a very long name that cannot fit';
const TASKS: GanttTask[] = [
  { id: 'a', name: 'Phase 1', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'b', name: LONG, status: 'completed', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'a', sortOrder: 20 },
  { id: 'c', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2027-01-08', parentTaskId: 'a', sortOrder: 30 },
  { id: 'd', name: 'Test', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', parentTaskId: 'a', sortOrder: 40 },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

async function settle(qc: QueryClient) {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise<void>(r => { setTimeout(r, 0); }); });
  await waitFor(() => expect(qc.isFetching()).toBe(0));
}

async function renderGantt(withBulk: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <GanttChart
        tasks={TASKS} scheduleName="P" scheduleId="s-look"
        onTaskClick={vi.fn()} onTaskSelect={vi.fn()} onTaskUpdate={vi.fn()} onTaskReorder={vi.fn()}
        onBulkUpdate={withBulk ? vi.fn(async () => {}) : undefined}
        onBulkDelete={withBulk ? vi.fn(async () => {}) : undefined}
      />
    </QueryClientProvider>,
  );
  await settle(qc);
  return utils;
}

const rowBoxes = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label^="Select "]:not([aria-label="Select all tasks"])'));
const selectAll = (c: HTMLElement) => c.querySelector('input[aria-label="Select all tasks"]') as HTMLInputElement;

describe('Gantt: a checkbox on every row', () => {
  it('shows a box on every row before anything is selected, and the header box', async () => {
    const { container } = await renderGantt(true);
    const boxes = rowBoxes(container);
    expect(boxes.map(b => b.getAttribute('aria-label'))).toEqual(['Select Phase 1', `Select ${LONG}`, 'Select Build', 'Select Test']);
    expect(boxes.every(b => !b.checked)).toBe(true);
    expect(selectAll(container)).toBeTruthy();
  });

  it('ticking a box selects that row; Shift+click ticks the range between two rows', async () => {
    const { container } = await renderGantt(true);
    fireEvent.click(rowBoxes(container)[1]);
    expect(rowBoxes(container).map(b => b.checked)).toEqual([false, true, false, false]);
    fireEvent.click(rowBoxes(container)[3], { shiftKey: true });
    expect(rowBoxes(container).map(b => b.checked)).toEqual([false, true, true, true]);
  });

  it('the header box ticks and clears every row', async () => {
    const { container } = await renderGantt(true);
    fireEvent.click(selectAll(container));
    expect(rowBoxes(container).every(b => b.checked)).toBe(true);
    fireEvent.click(selectAll(container));
    expect(rowBoxes(container).every(b => !b.checked)).toBe(true);
  });

  it('hides the boxes (does not disable them) where bulk changes are not allowed', async () => {
    const { container } = await renderGantt(false);
    expect(rowBoxes(container)).toHaveLength(0);
    expect(selectAll(container)).toBeNull();
  });
});

function Table() {
  const columnState = useColumnState('s-look-table');
  return <TableView tasks={TASKS} scheduleId="s-look-table" onTaskClick={() => {}} columnState={columnState} onTaskUpdate={() => {}} />;
}

describe('Table: looks like the Gantt', () => {
  const renderTable = () => {
    localStorage.setItem('tableview-cols:s-look-table', JSON.stringify(['rowNum', 'name', 'duration', 'startDate', 'endDate', 'status']));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><Table /></QueryClientProvider>);
  };

  it('draws every task row at the Gantt row height, on one line', () => {
    const { container } = renderTable();
    const rows = Array.from(container.querySelectorAll<HTMLElement>('tbody tr[data-task-id]'));
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.style.height).toBe(`${ROW_H}px`);
      expect(r.className).toContain('[&>td]:whitespace-nowrap');
      expect(r.className).toContain('[&>td]:py-0');
    }
  });

  it('cuts a long name with an ellipsis and shows the full name on hover', () => {
    const { container } = renderTable();
    const name = Array.from(container.querySelectorAll<HTMLElement>('tbody td span.truncate')).find(s => s.textContent === LONG)!;
    expect(name).toBeTruthy();
    expect(name.getAttribute('title')).toBe(LONG);
    expect(name.closest('td')!.className).toContain('overflow-hidden');
  });

  it('shows short dates: the year only when it is not this year', () => {
    const { container } = renderTable();
    const text = container.querySelector('tbody')!.textContent!;
    expect(text).toContain('Mar 2');
    expect(text).not.toContain('2026');
    expect(text).toMatch(/Jan 8, 27/);
    expect(formatDate('2026-06-26')).toBe('Jun 26');
    expect(formatDate(undefined)).toBe('-');
  });

  it('keeps a row checkbox on every row and the header box', () => {
    const { container } = renderTable();
    expect(container.querySelectorAll('tbody input[type="checkbox"]')).toHaveLength(4);
    expect(container.querySelector('thead input[type="checkbox"]')).toBeTruthy();
  });

  it('centres the small-number columns and left-aligns the name', () => {
    const { container } = renderTable();
    const ths = Array.from(container.querySelectorAll('thead th'));
    const th = (label: string) => ths.find(t => t.textContent?.trim().startsWith(label))!;
    expect(th('Task Name').className).toContain('text-left');
    expect(th('Duration').className).toContain('text-center');
    expect(th('Start Date').className).toContain('text-center');
    const nameTd = container.querySelector('tbody tr[data-task-id="b"] td span.truncate')!.closest('td')!;
    expect(nameTd.className).toContain('!text-left');
  });
});
