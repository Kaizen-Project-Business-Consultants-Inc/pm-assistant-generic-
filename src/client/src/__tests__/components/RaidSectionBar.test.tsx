import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const items = [
  { id: 'r1', type: 'risk', status: 'open', severity: 'high' },             // no plan → attention
  { id: 'r2', type: 'risk', status: 'open', severity: 'low' },
  { id: 'a1', type: 'action', status: 'open', dueDate: '2000-01-01' },     // overdue → attention
];
vi.mock('../../services/api', () => ({ apiService: { getRiskItems: vi.fn(async () => ({ data: items })) } }));

import { RaidSectionBar, useRaidSections, sectionCounts } from '../../components/risks/RaidSectionBar';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

/** U20: Risks & Issues sections */
describe('RAID sections', () => {
  afterEach(cleanup);

  it('opens on "Needs attention" when something needs it, and lists only those items', async () => {
    const setType = vi.fn();
    const { result } = renderHook(() => useRaidSections('p1', items, setType), { wrapper });
    await waitFor(() => expect(result.current.shownSection).toBe('attention'));
    expect(result.current.risks.map(r => r.id)).toEqual(['r1', 'a1']);
    expect(result.current.reasonOf.get('a1')).toBe('Overdue');
  });

  it('choosing a type sets the list filter; All clears it', async () => {
    const setType = vi.fn();
    const { result } = renderHook(() => useRaidSections('p1', items, setType), { wrapper });
    await waitFor(() => expect(result.current.attentionCount).toBe(2));
    result.current.chooseSection('risk');
    expect(setType).toHaveBeenLastCalledWith('risk');
    result.current.chooseSection('all');
    expect(setType).toHaveBeenLastCalledWith('');
  });

  it('counts per type from the stats; Dependencies appears only once there is one', () => {
    const counts = sectionCounts({ totalRisks: 2, totalIssues: 1, totalActions: 1 }, 2);
    expect(counts).toMatchObject({ attention: 2, risk: 2, issue: 1, action: 1, dependency: 0, all: 4 });
    const onChoose = vi.fn();
    render(<RaidSectionBar shown="attention" counts={counts} onChoose={onChoose} />);
    expect(screen.getByRole('button', { name: 'Needs attention, 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /Dependencies/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Risks, 2' }));
    expect(onChoose).toHaveBeenCalledWith('risk');
  });
});
