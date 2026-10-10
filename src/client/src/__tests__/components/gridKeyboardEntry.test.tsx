// @vitest-environment happy-dom
/**
 * The task grid in the real Gantt and Table (2026-10-09, WCAG 2.1.1):
 * - the grid root is one Tab stop with a name and keyboard help; tabbing onto it starts list
 *   mode; Alt+Shift+Right indents; Tab moves on (no trap);
 * - the Gantt's Delete key opens the delete confirmation only while working in the list.
 *   Anywhere else (or with nothing to delete) Delete does nothing and is not prevented, so it
 *   still deletes text in a field.
 * The hook-level rules for both views are in gridFocusScope.test.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { useColumnState } from '../../hooks/useColumnState';

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'Alpha', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20 },
  { id: 'b', name: 'Bravo', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30 },
];

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

function keyOn(target: EventTarget, k: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => { target.dispatchEvent(e); });
  return e;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

function renderGantt(over: Partial<Parameters<typeof GanttChart>[0]> = {}) {
  const fns = { onTaskUpdate: vi.fn(), onBulkUpdate: vi.fn(async () => {}), onBulkDelete: vi.fn(async () => {}), onDeleteTask: vi.fn() };
  const utils = wrap(<GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s-kbd" activeTaskId="b" {...fns} {...over} />);
  const grid = utils.container.querySelector('[role="grid"]') as HTMLElement;
  const confirmOpen = () => utils.queryByText('Delete Task') !== null;
  return { ...utils, grid, fns, confirmOpen };
}

describe('Gantt: Delete only acts while working in the list', () => {
  it('outside the list, Delete does nothing and is not prevented (page body, a text field)', () => {
    const { fns, confirmOpen } = renderGantt();
    const field = Object.assign(document.createElement('input'), { type: 'text', value: 'abc' });
    document.body.append(field);
    expect(keyOn(document.body, 'Delete').defaultPrevented).toBe(false);
    field.focus();
    expect(keyOn(field, 'Delete').defaultPrevented).toBe(false);
    expect(confirmOpen()).toBe(false);
    expect(fns.onBulkDelete).not.toHaveBeenCalled();
  });

  it('a click elsewhere after a click in the list ends it: Delete does nothing', () => {
    const { grid, confirmOpen } = renderGantt();
    fireEvent.mouseDown(grid.querySelector('[role="row"]')!);
    fireEvent.mouseDown(document.body);
    expect(keyOn(document.body, 'Delete').defaultPrevented).toBe(false);
    expect(confirmOpen()).toBe(false);
  });

  it('after a click in the list, Delete opens the confirmation for the active task', () => {
    const { grid, confirmOpen } = renderGantt();
    fireEvent.mouseDown(grid.querySelector('[role="row"]')!);
    expect(keyOn(document.body, 'Delete').defaultPrevented).toBe(true);
    expect(confirmOpen()).toBe(true);
  });

  it('tabbing onto the list, Delete opens the confirmation too', () => {
    const { grid, confirmOpen } = renderGantt();
    act(() => { grid.focus(); });
    expect(keyOn(grid, 'Delete').defaultPrevented).toBe(true);
    expect(confirmOpen()).toBe(true);
  });

  it('in the list with nothing to delete (no active task, or read-only), Delete is not prevented', () => {
    const { grid, confirmOpen } = renderGantt({ activeTaskId: null });
    act(() => { grid.focus(); });
    expect(keyOn(grid, 'Delete').defaultPrevented).toBe(false);
    expect(confirmOpen()).toBe(false);
    cleanup();
    const ro = renderGantt({ onBulkDelete: undefined, onDeleteTask: undefined, onTaskUpdate: undefined, onBulkUpdate: undefined });
    act(() => { ro.grid.focus(); });
    expect(keyOn(ro.grid, 'Delete').defaultPrevented).toBe(false);
    expect(ro.confirmOpen()).toBe(false);
  });
});

function TableHarness(props: { onTaskUpdate?: (id: string, d: Record<string, unknown>) => void; onBulkUpdate?: (ids: string[], f: string, v: string) => Promise<void>; onTaskSelect?: (t: GanttTask) => void }) {
  const columnState = useColumnState('s-kbd-table');
  return <TableView tasks={TASKS} scheduleId="s-kbd-table" onTaskClick={() => {}} columnState={columnState} {...props} />;
}

const views = [
  {
    name: 'Gantt',
    mount: (editable: boolean) => {
      const g = renderGantt(editable ? {} : { onTaskUpdate: undefined, onBulkUpdate: undefined, activeTaskId: null });
      return { grid: g.grid, changed: () => [...g.fns.onTaskUpdate.mock.calls, ...g.fns.onBulkUpdate.mock.calls] };
    },
    mountUnselected: () => {
      const onTaskSelect = vi.fn();
      const g = renderGantt({ activeTaskId: null, onTaskSelect });
      return { grid: g.grid, selected: () => onTaskSelect.mock.calls.map(c => (c[0] as GanttTask).id) };
    },
  },
  {
    name: 'Table',
    mount: (editable: boolean) => {
      const fns = { onTaskUpdate: vi.fn(), onBulkUpdate: vi.fn(async () => {}) };
      const utils = wrap(<TableHarness {...(editable ? fns : {})} />);
      return { grid: utils.container.querySelector('[role="grid"]') as HTMLElement, changed: () => [...fns.onTaskUpdate.mock.calls, ...fns.onBulkUpdate.mock.calls] };
    },
    mountUnselected: () => {
      const onTaskSelect = vi.fn();
      const utils = wrap(<TableHarness onTaskUpdate={vi.fn()} onTaskSelect={onTaskSelect} />);
      return { grid: utils.container.querySelector('[role="grid"]') as HTMLElement, selected: () => onTaskSelect.mock.calls.map(c => (c[0] as GanttTask).id) };
    },
  },
];

for (const view of views) {
  describe(`${view.name}: the grid is one Tab stop with a name and keyboard help`, () => {
    it('has a screen-reader name, keyboard help and tabIndex 0, and shows a focus ring', () => {
      const { grid } = view.mount(true);
      expect(grid.tabIndex).toBe(0);
      const name = grid.getAttribute('aria-label') ?? grid.querySelector('caption')?.firstChild?.textContent ?? '';
      expect(name.trim().length).toBeGreaterThan(0);
      const help = document.getElementById(grid.getAttribute('aria-describedby') ?? '');
      expect(help?.textContent).toMatch(/Alt\+Shift\+Right Arrow indents/);
      expect(help?.textContent).toMatch(/Tab moves on/);
      expect(grid.className).toContain('focus-visible:ring-2');
    });

    it('Tab onto it, arrow down, Alt+Shift+Right indents; Tab moves on (no trap); the cell is read out', () => {
      const { grid, changed } = view.mount(true);
      act(() => { grid.focus(); });
      keyOn(grid, 'ArrowDown');
      keyOn(grid, 'ArrowDown'); // Phase → Alpha → Bravo
      expect(document.body.textContent).toContain('Task name for Bravo'); // the polite live region
      expect(keyOn(grid, 'ArrowRight', { altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
      expect(changed().length).toBe(1);
      expect(keyOn(grid, 'Tab').defaultPrevented).toBe(false);
      expect(keyOn(grid, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
      expect(changed().length).toBe(1);
    });

    it('after an inline edit, the focus goes back on the grid and the cell is still read out', () => {
      const { grid } = view.mount(true);
      act(() => { grid.focus(); });
      keyOn(grid, 'ArrowDown'); // off the summary row: an editable name cell
      keyOn(grid, 'Enter'); // edit the focused cell
      const input = grid.querySelector('input[type="text"]:focus, input:focus') as HTMLInputElement | null
        ?? (document.activeElement as HTMLInputElement);
      expect(input?.tagName).toBe('INPUT');
      fireEvent.keyDown(input, { key: 'Escape' }); // close the edit
      expect(document.activeElement).toBe(grid);
      keyOn(grid, 'ArrowDown');
      expect(document.body.textContent).toMatch(/Task name for (Alpha|Bravo)/);
    });

    it('tabbing in with no task selected selects the first row, so Delete has a task to act on', () => {
      const { grid, selected } = view.mountUnselected();
      act(() => { grid.focus(); });
      expect(selected()).toEqual(['p']);
    });

    it('read-only: the help says so and Alt+Shift+Right changes nothing', () => {
      const { grid, changed } = view.mount(false);
      expect(document.getElementById(grid.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/not change it/);
      act(() => { grid.focus(); });
      keyOn(grid, 'ArrowRight', { altKey: true, shiftKey: true });
      expect(keyOn(grid, 'Tab').defaultPrevented).toBe(false);
      expect(changed()).toEqual([]);
    });
  });
}
