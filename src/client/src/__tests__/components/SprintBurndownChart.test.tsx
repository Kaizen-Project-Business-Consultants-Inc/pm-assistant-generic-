import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getSprintBurndown: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));

import { SprintBurndownChart } from '../../components/sprints/SprintBurndownChart';

function renderChart() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SprintBurndownChart sprintId="s1" />
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SprintBurndownChart', () => {
  it('draws the server’s per-day ideal line (flat over the weekend) and the actual line', async () => {
    // Thu 1 – Wed 7 Jan: the ideal stays at 6 over Sat/Sun; actual known up to Mon 5
    api.getSprintBurndown.mockResolvedValue({
      burndown: {
        dates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'],
        ideal: [8, 6, 6, 6, 4, 2, 0],
        actual: [8, 7, 7, 7, 5, -1, -1],
        totalPoints: 8,
        daysRemaining: 2,
      },
    });
    const { container } = renderChart();

    expect(await screen.findByText('Sprint Burndown')).toBeInTheDocument();
    const lines = container.querySelectorAll('polyline');
    const ideal = lines[0].getAttribute('points')!.split(' ');
    expect(ideal).toHaveLength(7);
    // Fri, Sat and Sun sit at the same height: no burn on the weekend
    const y = (p: string) => p.split(',')[1];
    expect(y(ideal[1])).toBe(y(ideal[2]));
    expect(y(ideal[2])).toBe(y(ideal[3]));
    expect(y(ideal[4])).not.toBe(y(ideal[3]));
    // Actual line stops at the status date (5 known days)
    expect(lines[1].getAttribute('points')!.split(' ')).toHaveLength(5);
    // Summary: 3 done, 5 left, 2 working days left
    const stats = [...container.querySelectorAll('.text-lg')].map(e => e.textContent);
    expect(stats).toEqual(['8', '3', '5', '2']);
    expect(screen.getByText('working days')).toBeInTheDocument();
  });

  it('shows the empty state when the sprint has no days', async () => {
    api.getSprintBurndown.mockResolvedValue({ burndown: { dates: [], ideal: [], actual: [], totalPoints: 0 } });
    renderChart();
    expect(await screen.findByText('No burndown data available')).toBeInTheDocument();
  });
});
