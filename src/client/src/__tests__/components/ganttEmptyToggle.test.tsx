// @vitest-environment happy-dom
/**
 * GanttChart's "No tasks to display" state (shown when nothing can be added, e.g. a viewer, or a
 * filter that matches nothing) used to return before seven hooks. Going from some tasks to none,
 * or back, then made React throw "Rendered fewer/more hooks than expected" and the Gantt crashed.
 * The empty state now comes after every hook (2026-10-05).
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../services/api', () => ({
  apiService: {
    getResources: vi.fn(async () => ({ resources: [] })),
    getGlobalResourceWorkload: vi.fn(async () => ({ workload: [] })),
  },
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'Build', status: 'in_progress', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20,
    dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] },
];

afterEach(() => { cleanup(); });

describe('GanttChart: tasks → none → tasks', () => {
  it.each([
    ['a viewer (nothing can be added)', {}],
    ['an editor with no quick add', { onAddTask: vi.fn(), onTaskUpdate: vi.fn(), onTaskDragEnd: vi.fn() }],
  ])('%s: no hook-order crash, and the right screen each time', (_n, extra) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
    const props = (tasks: GanttTask[]) => ({ tasks, scheduleName: 'Plan', scheduleId: 's1', ...extra });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rerender, container } = render(wrap(<GanttChart {...props(TASKS)} />));
    expect(container.textContent).toContain('Build');
    expect(() => rerender(wrap(<GanttChart {...props([])} />))).not.toThrow();
    expect(container.textContent).toContain('No tasks to display.');
    expect(() => rerender(wrap(<GanttChart {...props(TASKS)} />))).not.toThrow();
    expect(container.textContent).toContain('Build');
    expect(container.textContent).not.toContain('No tasks to display.');
    expect(() => rerender(wrap(<GanttChart {...props([])} />))).not.toThrow();
    expect(container.textContent).toContain('No tasks to display.');

    const hookErrors = errors.mock.calls.filter(c => /hooks|Rendered (fewer|more)/i.test(String(c[0])));
    expect(hookErrors).toEqual([]);
    errors.mockRestore();
  });

  it('starting empty, then getting tasks, does not crash either', () => {
    const qc = new QueryClient();
    const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
    const { rerender, container } = render(wrap(<GanttChart tasks={[]} scheduleName="Plan" scheduleId="s1" />));
    expect(container.textContent).toContain('No tasks to display.');
    expect(() => rerender(wrap(<GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s1" />))).not.toThrow();
    expect(container.textContent).toContain('Plan');
  });
});
