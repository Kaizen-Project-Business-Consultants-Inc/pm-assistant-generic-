// @vitest-environment happy-dom
/**
 * Sprint list "actual velocity" (2026-10-06). It used to read `velocityActual`, which the server
 * never sent, so every sprint showed "? / 20 pts" and the header sparkline never appeared. The
 * server now saves the figure when a sprint is completed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getSprints = vi.fn();
vi.mock('../../services/api', () => ({
  apiService: { getSprints: (...a: unknown[]) => getSprints(...a) },
}));

import { SprintList } from '../../components/sprints/SprintList';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const stats = (completedPoints: number, totalPoints: number) => ({ totalTasks: 4, completedTasks: 2, totalPoints, completedPoints });

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SprintList projectId="p1" onSelect={() => {}} onCreate={() => {}} />
    </QueryClientProvider>,
  );
}

describe('SprintList — actual velocity', () => {
  it('a completed sprint shows the velocity saved at close, even after a task was reopened', async () => {
    // closed with 13 done; one 8-pt task reopened since, so today's count is 5
    getSprints.mockResolvedValue({ data: [
      { id: 's1', name: 'Sprint 1', status: 'completed', startDate: '2026-09-01', endDate: '2026-09-12', velocityCommitment: 20, velocityActual: 13, taskStats: stats(5, 21) },
    ] });
    renderList();
    const cell = await screen.findByTitle(/Actual velocity/);
    expect(cell.textContent).toBe('13 / 20 pts');
    expect(screen.queryByText('?')).toBeNull();
  });

  it('a running sprint shows the points done so far, not "?"', async () => {
    getSprints.mockResolvedValue({ data: [
      { id: 's2', name: 'Sprint 2', status: 'active', startDate: '2026-09-15', endDate: '2026-09-26', velocityCommitment: 20, velocityActual: null, taskStats: stats(7, 18) },
    ] });
    renderList();
    const cell = await screen.findByTitle(/Points completed so far/);
    expect(cell.textContent).toBe('7 / 20 pts');
  });

  it('a sprint with no story points shows 0', async () => {
    getSprints.mockResolvedValue({ data: [
      { id: 's3', name: 'Sprint 3', status: 'completed', startDate: '2026-08-01', endDate: '2026-08-12', velocityCommitment: 10, velocityActual: 0, taskStats: stats(0, 0) },
    ] });
    renderList();
    expect((await screen.findByTitle(/Actual velocity/)).textContent).toBe('0 / 10 pts');
  });

  it('the header sparkline appears once two sprints are completed', async () => {
    getSprints.mockResolvedValue({ data: [
      { id: 'b', name: 'Sprint B', status: 'completed', startDate: '2026-09-15', endDate: '2026-09-26', velocityActual: 18 },
      { id: 'a', name: 'Sprint A', status: 'completed', startDate: '2026-09-01', endDate: '2026-09-12', velocityActual: 13 },
    ] });
    const { container } = renderList();
    await screen.findByText('Sprint A');
    expect(container.querySelector('polyline')).not.toBeNull();
    // oldest on the left: Sprint A (13) is lower than Sprint B (18), so the line rises
    const pts = container.querySelector('polyline')!.getAttribute('points')!.split(' ').map(p => Number(p.split(',')[1]));
    expect(pts[0]).toBeGreaterThan(pts[1]); // SVG y grows downwards
  });
});
