/**
 * Indent in the Gantt right-click menu is offered only while "the row above" is the plan's row above:
 * not when the list is a filtered view of a larger plan (2026-10-30). A sorted list or a search is
 * covered by the same flag (indentAvailability / useIndentTasks tests).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: {
    getResources: vi.fn(async () => ({ resources: [] })),
    getGlobalResourceWorkload: vi.fn(async () => ({ workload: [] })),
  },
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';

const mk = (id: string, name: string, sortOrder: number): GanttTask =>
  ({ id, name, status: 'pending', priority: 'medium', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder } as GanttTask);
const ALL = [mk('a', 'Alpha', 10), mk('b', 'Beta', 20), mk('c', 'Gamma', 30)];

async function openMenuOnBeta(tasks: GanttTask[], allTasks: GanttTask[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <GanttChart tasks={tasks} allTasks={allTasks} scheduleName="S" scheduleId="s1" onMoveTasks={vi.fn(async () => {})} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(qc.isFetching()).toBe(0));
  await act(async () => { await new Promise<void>(r => { setTimeout(r, 0); }); });
  fireEvent.contextMenu(container.querySelector('[data-task-id="b"]')!, { clientX: 50, clientY: 60 });
  await act(async () => { await new Promise<void>(r => { setTimeout(r, 0); }); });
}

afterEach(() => cleanup());

describe('Gantt right-click Indent follows the plan order', () => {
  it('the whole plan: Indent is offered', async () => {
    await openMenuOnBeta(ALL, ALL);
    expect(screen.queryByRole('menuitem', { name: /^Indent/ })).toBeTruthy();
  });

  it('a filtered list (fewer rows than the plan): Indent is not offered', async () => {
    await openMenuOnBeta([ALL[0], ALL[1]], ALL);
    expect(screen.getByRole('menu', { name: 'Row menu' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Indent/ })).toBeNull();
  });
});
