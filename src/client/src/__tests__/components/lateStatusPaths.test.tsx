// @vitest-environment happy-dom
/**
 * Late in the real paths (review of the five-status change): the filter, the Sprint Board and the
 * Calendar labels all treat a task that is Late (past its finish, or marked Late) as Late.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getSprintBoard: vi.fn(),
  getBulkReadiness: vi.fn(async () => ({ readiness: {} })),
  updateTask: vi.fn(),
  updateSprintTaskPoints: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { SprintBoard } from '../../components/sprints/SprintBoard';
import { CalendarView } from '../../components/schedule/CalendarView';
import { useTaskFiltering, ganttSortValue } from '../../components/schedule/gantt/hooks/useTaskFiltering';
import type { GanttFilters, GanttTask } from '../../components/schedule/gantt/types';
import { toLocalDate } from '../../utils/dateUtils';

afterEach(() => { cleanup(); });

const base = { priority: 'medium', startDate: '2020-01-01' };
const TASKS = [
  { id: 'past', name: 'Past finish', status: 'in_progress', endDate: '2020-02-01', ...base },
  { id: 'future', name: 'Future finish', status: 'in_progress', endDate: '2999-01-01', ...base },
  { id: 'manual', name: 'Marked late', status: 'late', endDate: '2999-01-01', ...base },
  { id: 'done', name: 'Finished', status: 'completed', endDate: '2020-02-01', ...base },
] as GanttTask[];
const filters = (statuses: string[]): GanttFilters => ({
  statuses: new Set(statuses), priorities: new Set(), assignee: '', startAfter: '', startBefore: '', progressMin: null, progressMax: null,
}) as GanttFilters;

describe('the Gantt status filter uses the status people see', () => {
  const rowsFor = (statuses: string[]) => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    act(() => result.current.setFilters(filters(statuses)));
    return result.current.rows.map(r => r.task.id);
  };
  it('Late shows tasks past their finish and tasks marked Late', () => {
    expect(rowsFor(['late']).sort()).toEqual(['manual', 'past']);
  });
  it('On Track no longer includes the late ones, and Completed is never late', () => {
    expect(rowsFor(['in_progress'])).toEqual(['future']);
    expect(rowsFor(['completed'])).toEqual(['done']);
  });
  it('sorting by status puts Late after On Track', () => {
    const v = (id: string) => ganttSortValue(TASKS.find(t => t.id === id)!, 'status', {} as never);
    expect(v('future')).toBeLessThan(v('past') as number);
    expect(v('past')).toBe(v('manual'));
    expect(v('past')).toBeLessThan(v('done') as number);
  });
});

describe('Sprint Board', () => {
  it('keeps a task stored as Late in the In Progress column (it used to vanish)', async () => {
    api.getSprintBoard.mockResolvedValue({ board: { scheduleId: 's1', tasks: [{ id: 'a', name: 'Alpha', status: 'late', priority: 'medium' }] } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><SprintBoard sprintId="sp1" canEdit /></QueryClientProvider>);
    await waitFor(() => expect(container.textContent).toContain('Alpha'));
    const card = Array.from(container.querySelectorAll('span')).find(s => s.textContent === 'Alpha')!;
    expect(card.closest('.flex-1')!.querySelector('.uppercase')!.textContent).toBe('In Progress');
  });
});

describe('Calendar view', () => {
  it('names the status on each task, not just its colour', () => {
    const today = toLocalDate();
    const { container } = render(<CalendarView tasks={[
      { id: 'a', name: 'Steady task', status: 'in_progress', startDate: today, endDate: today },
      { id: 'b', name: 'Slipping task', status: 'late', startDate: today, endDate: today },
    ] as GanttTask[]} onTaskClick={() => {}} />);
    const labels = Array.from(container.querySelectorAll('[aria-label]')).map(e => e.getAttribute('aria-label'));
    expect(labels).toContain('Steady task — On Track');
    expect(labels).toContain('Slipping task — Late');
  });
});
