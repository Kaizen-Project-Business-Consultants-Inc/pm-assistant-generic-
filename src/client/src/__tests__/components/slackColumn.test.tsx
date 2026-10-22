import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Total slack shows by default (U69, 2026-10-21). On a plan with no links there is no critical
 * path — the calculation puts every task on day 0, so the longest task would read "0 d" (red,
 * "critical") and a short one "197 d". Those plans show "—" (review 2026-10-21).
 */
vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));
vi.mock('../../hooks/useProjectRole', () => ({
  useProjectRole: () => ({ canEdit: true, isManager: true, role: 'pm', isLoading: false }),
}));
vi.mock('../../components/schedule/ResourcePickerDropdown', () => ({ ResourcePickerDropdown: () => null }));

import { TableView } from '../../components/schedule/TableView';
import { useColumnState } from '../../hooks/useColumnState';
import type { GanttTask } from '../../components/schedule/GanttChart';

afterEach(() => { cleanup(); localStorage.clear(); });

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Build', status: 'pending', startDate: '2026-11-02', endDate: '2026-11-20', sortOrder: 1, dependencies: [] },
  { id: 'b', name: 'Test', status: 'pending', startDate: '2026-11-23', endDate: '2026-11-25', sortOrder: 2, dependencies: [] },
];
const cpm = (hasLinks: boolean) => ({
  hasLinks,
  criticalPathTaskIds: ['a'],
  tasks: [
    { taskId: 'a', ES: 0, EF: 15, LS: 0, LF: 15, duration: 15, totalFloat: 0, freeFloat: 0, isCritical: true },
    { taskId: 'b', ES: 0, EF: 3, LS: 12, LF: 15, duration: 3, totalFloat: 12, freeFloat: 12, isCritical: false },
  ],
});

function Table({ hasLinks }: { hasLinks: boolean }) {
  const columnState = useColumnState('s-slack');
  return <TableView tasks={TASKS} scheduleId="s-slack" columnState={columnState} cpmData={cpm(hasLinks) as never} onTaskClick={() => {}} />;
}
const show = (hasLinks: boolean) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><Table hasLinks={hasLinks} /></MemoryRouter></QueryClientProvider>,
);
const slackOf = (name: string) => {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;
  const col = screen.getAllByRole('columnheader').findIndex(h => /Total slack/.test(h.textContent ?? ''));
  return (row.children[col] as HTMLElement).textContent;
};

describe('Total slack column', () => {
  it('is shown by default; a linked plan shows the days, 0 d for the critical task', () => {
    show(true);
    expect(screen.getByRole('columnheader', { name: /Total slack/ })).toBeInTheDocument();
    expect(slackOf('Build')).toBe('0 d');
    expect(slackOf('Test')).toBe('12 d');
  });

  it('a plan with no links shows — instead of made-up slack', () => {
    show(false);
    expect(slackOf('Build')).toBe('—');
    expect(slackOf('Test')).toBe('—');
  });
});
