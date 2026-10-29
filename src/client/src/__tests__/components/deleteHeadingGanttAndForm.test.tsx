// @vitest-environment happy-dom
/**
 * Deleting a heading (2026-10-29), the screens around the dialog:
 * - the Gantt counts the tasks under the heading from the WHOLE plan, not the rows a filter shows
 * - heading and its tasks: the Gantt and Table send "delete" and the focus lands on the row after all of them
 * - the task form asks only once: a heading skips the form's own "Delete?" (the Schedule screen asks the real question)
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor, within, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: (_t, name) => (name === 'getResources' ? async () => ({ resources: [] }) : async () => ({})) }),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TaskFormModal } from '../../components/schedule/TaskFormModal';

const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return (this as HTMLElement).parentElement; } });
});
afterAll(() => { if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent); });

const d = { startDate: '2026-03-02', endDate: '2026-03-06', status: 'pending' };
const HEAD: GanttTask = { id: 'h', name: 'Heading', ...d, sortOrder: 10, isSummary: true };
const KIDS: GanttTask[] = Array.from({ length: 6 }, (_, i) => ({ id: `k${i}`, name: `Kid ${i}`, ...d, parentTaskId: 'h', sortOrder: 20 + i }));
const AFTER: GanttTask = { id: 'z', name: 'Zulu', ...d, sortOrder: 99 };
const ALL = [HEAD, ...KIDS, AFTER];

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); document.body.innerHTML = ''; });

describe('Gantt delete of a heading', () => {
  // A filter shows only the heading and the task after it; its six tasks are hidden by the filter
  const filtered = [HEAD, AFTER];
  const open = (onBulkDelete = vi.fn(async () => {})) => {
    const view = wrap(<GanttChart tasks={filtered} allTasks={ALL} scheduleName="Plan" scheduleId="s-del" activeTaskId="h"
      onTaskUpdate={() => {}} onBulkUpdate={async () => {}} onBulkDelete={onBulkDelete} onTaskClick={() => {}} onDeleteTask={() => {}} />);
    fireEvent.click(within(view.container.querySelector('[role="row"][data-task-id="h"]') as HTMLElement).getByRole('button', { name: 'Delete Heading' }));
    return { ...view, onBulkDelete };
  };

  it('counts the six tasks under it even though the filter shows none of them', () => {
    open();
    const dlg = screen.getByRole('alertdialog', { name: 'Delete "Heading"?' });
    expect(dlg.textContent).toContain('This heading has 6 tasks under it');
    expect(within(dlg).getByRole('button', { name: /Delete the heading and its 6 tasks/ })).toBeTruthy();
  });

  it('"heading and its tasks" sends delete; the focus lands on the row after the heading and all its tasks', async () => {
    const { container, onBulkDelete } = open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Delete the heading and its 6 tasks/ })); });
    expect(onBulkDelete).toHaveBeenCalledWith(['h'], 'delete');
    const grid = container.querySelector('[role="treegrid"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(grid));
    await waitFor(() => expect(grid.getAttribute('aria-activedescendant') ?? '').toMatch(/-cell-z-name$/));
  });

  it('"heading only" sends keep', async () => {
    const { onBulkDelete } = open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Delete the heading only/ })); });
    expect(onBulkDelete).toHaveBeenCalledWith(['h'], 'keep');
  });
});

describe('task form delete', () => {
  const form = (task: GanttTask, onDelete: () => void) =>
    wrap(<TaskFormModal task={task} allTasks={ALL} onClose={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />);

  it('a heading with tasks under it goes straight to the Schedule screen\'s question: no second dialog here', () => {
    const onDelete = vi.fn();
    form(HEAD, onDelete);
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(onDelete).toHaveBeenCalledWith('h');
    expect(screen.queryByText(/You can undo this from History/)).toBeNull();
  });

  it('a plain task still asks its own "Delete?" first', () => {
    const onDelete = vi.fn();
    form(AFTER, onDelete);
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/You can undo this from History/)).toBeTruthy();
  });
});
