// @vitest-environment happy-dom
/**
 * The Table's row drag (by the grip): Escape cancels it — the row stays where it was and no new
 * order is saved, the same as the Gantt's link drawing and bar drags (2026-10-06). Letting go on
 * another row without Escape still reorders.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { TableView } from '../../components/schedule/TableView';
import type { GanttTask } from '../../components/schedule/GanttChart';
import { useColumnState } from '../../hooks/useColumnState';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Table({ onTaskReorder }: { onTaskReorder: (u: unknown) => void }) {
  const columnState = useColumnState('s-row-drag-esc');
  return <TableView tasks={TASKS} scheduleId="s-row-drag-esc" onTaskClick={() => {}} columnState={columnState} onTaskUpdate={() => {}} onTaskReorder={onTaskReorder} />;
}

function setup() {
  const onTaskReorder = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(<QueryClientProvider client={qc}><Table onTaskReorder={onTaskReorder} /></QueryClientProvider>);
  const rows = Array.from(container.querySelectorAll('tr[data-row-idx]')) as HTMLElement[];
  expect(rows.length).toBe(2);
  // Row i occupies y = i*30 .. i*30+30
  rows.forEach((tr, i) => {
    tr.getBoundingClientRect = () => ({ left: 0, right: 800, top: i * 30, bottom: i * 30 + 30, width: 800, height: 30, x: 0, y: i * 30, toJSON: () => ({}) });
  });
  const grip = rows[0].querySelector('[aria-label="Drag to reorder"]') as HTMLElement;
  expect(grip).not.toBeNull();
  return { onTaskReorder, grip };
}

const drag = (grip: HTMLElement) => {
  fireEvent.mouseDown(grip, { clientX: 5, clientY: 15 });
  act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 45, bubbles: true })); });
};
const letGo = () => act(() => { document.dispatchEvent(new MouseEvent('mouseup', { clientX: 5, clientY: 45, bubbles: true })); });

describe('Table row drag — Escape', () => {
  it('without Escape, dropping row 1 on row 2 saves a new order', () => {
    const { onTaskReorder, grip } = setup();
    drag(grip);
    letGo();
    expect(onTaskReorder).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels: nothing saved, letting go afterwards does nothing, and no other Escape handler runs', () => {
    const { onTaskReorder, grip } = setup();
    const other = vi.fn();
    document.addEventListener('keydown', other);
    try {
      drag(grip);
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      expect(other).not.toHaveBeenCalled();
      letGo();
      expect(onTaskReorder).not.toHaveBeenCalled();
      // Escape is back to normal once the drag is over
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(other).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', other);
    }
  });
});
