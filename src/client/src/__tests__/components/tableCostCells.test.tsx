// @vitest-environment happy-dom
/**
 * Table: Budget and Actual Cost are calculated, read-only cells (2026-10-07, user-approved).
 * Since 2026-10-02 (T073) the app works them out from hours × rate and the server ignores a typed
 * value; the cells used to look editable, a typed value vanished and a paste was refused (400).
 * Now: they don't open for typing (click, Enter), are drawn greyed, refuse a paste, and say where
 * the figure comes from (tooltip + accessible description). Other cells are unchanged.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { TableView } from '../../components/schedule/TableView';
import type { GanttTask } from '../../components/schedule/GanttChart';
import { useColumnState } from '../../hooks/useColumnState';
import { COLUMN_DEFS } from '../../components/schedule/tableColumns';

const SID = 's-cost-cells';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', estimatedDurationHours: 40, sortOrder: 10, budgetAllocated: 4000, actualCost: 1250 },
  { id: 'b', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];

function Table({ onTaskUpdate, activeTaskId }: { onTaskUpdate: (id: string, d: Record<string, unknown>) => void; activeTaskId?: string }) {
  const columnState = useColumnState(SID);
  return <TableView tasks={TASKS} scheduleId={SID} onTaskClick={() => {}} columnState={columnState} onTaskUpdate={onTaskUpdate} activeTaskId={activeTaskId} />;
}

function setup(activeTaskId?: string) {
  const onTaskUpdate = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={qc}><Table onTaskUpdate={onTaskUpdate} activeTaskId={activeTaskId} /></QueryClientProvider>);
  const headers = Array.from(container.querySelectorAll('thead tr:first-child th')).map(th => th.textContent?.trim() ?? '');
  const colIdx = (label: string) => {
    const i = headers.findIndex(h => h.startsWith(label));
    expect(i, `header ${label} in ${headers.join('|')}`).toBeGreaterThan(-1);
    return i;
  };
  const row = (name: string) => Array.from(container.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes(name)) as HTMLElement;
  const cell = (name: string, label: string) => row(name).children[colIdx(label)] as HTMLElement;
  return { container, onTaskUpdate, cell };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(`tableview-cols:${SID}`, JSON.stringify(['rowNum', 'name', 'estimatedDurationHours', 'budgetAllocated', 'actualCost']));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const COST: Array<[string, string]> = [
  ['Budget', 'Calculated: booked hours × rate'],
  ['Actual Cost', 'Calculated: approved timesheet hours × rate'],
];

describe('Budget and Actual Cost in the Table', () => {
  it('are not editable columns (still hidden by default and sortable)', () => {
    for (const key of ['budgetAllocated', 'actualCost']) {
      expect(COLUMN_DEFS.find(c => c.key === key)).toMatchObject({ defaultVisible: false, editable: false, sortable: true });
    }
  });

  it('show the figure, greyed, and do not open for typing on click (active row) or Enter', () => {
    const { cell, onTaskUpdate } = setup('a');
    expect(cell('Plan', 'Budget').textContent).toBe('$4,000');
    expect(cell('Plan', 'Actual Cost').textContent).toBe('$1,250');
    for (const [label] of COST) {
      fireEvent.click(cell('Plan', label));
      expect(cell('Plan', label).querySelector('input'), label).toBeNull();
      expect(cell('Plan', label).className).toContain('cursor-default');
      expect(cell('Plan', label).className).toContain('opacity-70');
      // On a row that isn't active, a click focuses the cell; Enter / F2 then try to open it
      fireEvent.click(cell('Build', label));
      act(() => { fireEvent.keyDown(document, { key: 'Enter' }); });
      expect(cell('Build', label).querySelector('input'), label).toBeNull();
      act(() => { fireEvent.keyDown(document, { key: 'F2' }); });
      expect(cell('Build', label).querySelector('input'), label).toBeNull();
    }
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('say where the figure comes from: a tooltip, and the same text announced as the cell\'s description', () => {
    const { cell, container } = setup();
    for (const [label, hint] of COST) {
      for (const name of ['Plan', 'Build']) {
        const td = cell(name, label);
        expect(td.getAttribute('title')).toBe(hint);
        const id = td.getAttribute('aria-describedby');
        expect(id, `${name} ${label}`).toBeTruthy();
        const desc = container.ownerDocument.getElementById(id!);
        expect(desc?.textContent).toBe(hint);
        expect(desc?.hasAttribute('hidden')).toBe(true); // read by screen readers via aria-describedby, not shown twice
      }
    }
  });

  it('refuse a paste (copied from another cost cell) and send nothing', () => {
    const { cell, onTaskUpdate } = setup();
    for (const [label] of COST) {
      fireEvent.click(cell('Plan', label)); // focuses the cell (row not active)
      act(() => { fireEvent.keyDown(document, { key: 'c', ctrlKey: true }); });
      fireEvent.click(cell('Build', label));
      act(() => { fireEvent.keyDown(document, { key: 'v', ctrlKey: true }); });
      expect(cell('Build', label).textContent, label).toBe('—');
    }
    expect(onTaskUpdate).not.toHaveBeenCalled();
  });

  it('leave the other cells as they were: Work still opens and saves', () => {
    const { cell, onTaskUpdate } = setup('a');
    fireEvent.click(cell('Plan', 'Work'));
    const input = cell('Plan', 'Work').querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Work (hours) for Plan');
    expect(cell('Plan', 'Work').hasAttribute('aria-describedby')).toBe(false);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTaskUpdate).toHaveBeenCalledWith('a', { estimatedDurationHours: 12 });
  });
});

describe('when the cost columns are hidden (the default)', () => {
  it('no hint text is added to the page', () => {
    localStorage.setItem(`tableview-cols:${SID}`, JSON.stringify(['rowNum', 'name']));
    const { container } = setup();
    expect(container.querySelector('caption')?.children.length).toBe(0);
    expect(container.querySelector('caption')?.textContent?.trim()).toBe('Project schedule tasks');
  });
});
