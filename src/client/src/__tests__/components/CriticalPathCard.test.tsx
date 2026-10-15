import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const cpm = vi.hoisted(() => ({ value: {} as any }));
vi.mock('../../services/api', () => ({ apiService: { getCriticalPath: vi.fn(async () => cpm.value) } }));

import { CriticalPathCard } from '../../components/schedule/CriticalPathCard';

const show = (onOpen?: () => void) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CriticalPathCard scheduleId="s1" onOpen={onOpen} />
  </QueryClientProvider>,
);

/** U17: the critical path found from the Overview, without knowing the Gantt switch */
describe('CriticalPathCard', () => {
  afterEach(cleanup);

  it('shows length, critical tasks and end date, with a way to the Gantt', async () => {
    cpm.value = { projectDuration: 42, criticalPathTaskIds: ['a', 'b', 'c'], hasLinks: true, finishDate: '2026-12-04' };
    const onOpen = vi.fn();
    show(onOpen);
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Dec 4, 2026')).toBeTruthy();
    screen.getByRole('button', { name: 'Show it on the Gantt' }).click();
    expect(onOpen).toHaveBeenCalled();
  });

  it('with no linked tasks it says to link them first', async () => {
    cpm.value = { projectDuration: 5, criticalPathTaskIds: ['a'], hasLinks: false, finishDate: null };
    show(() => {});
    expect(await screen.findByText(/link your tasks first/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link tasks in the schedule' })).toBeTruthy();
  });
});
