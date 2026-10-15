import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: {
    getProjectGroups: vi.fn(async () => ({ groups: [{ id: 'c1', name: 'DBJ Bank', holidayCalendarId: 'cal-jm' }] })),
    getHolidayCalendars: vi.fn(async () => ({ calendars: [{ id: 'home', name: 'Company holidays' }, { id: 'cal-jm', name: 'Jamaica 2026' }] })),
    getProjectSponsor: vi.fn(async () => ({ sponsor: { kind: 'person', id: 's1', name: 'Pat Sponsor' } })),
    // the server's list includes weekends and holidays (CalendarService.getNonWorkingDates)
    getNonWorkingDates: vi.fn(async () => ({ dates: ['2026-11-07', '2026-11-08', '2026-11-11', '2026-11-14', '2026-11-15'] })),
  },
}));

import { ProjectDetailsCard, inWords, timeLeft } from '../../components/project/ProjectDetailsCard';

/** U15: the details grouped (Who / When / Money / What), in words, not code values */
describe('ProjectDetailsCard', () => {
  afterEach(cleanup);

  it('words, not codes', () => {
    expect(inWords('web_development')).toBe('Web development');
    expect(inWords('hybrid')).toBe('Hybrid');
    expect(inWords(undefined)).toBe('');
  });

  it('time left in working days, or when it starts / ended', () => {
    expect(timeLeft('2026-11-02', '2026-12-18', '2026-10-14')).toBe('starts in 19 days');
    expect(timeLeft('2026-10-01', '2026-10-16', '2026-10-14')).toBe('3 working days left');
    expect(timeLeft('2026-09-01', '2026-10-09', '2026-10-14')).toBe('ended 5 days ago');
  });

  it('groups the details and names the client, sponsor, PM and calendar', async () => {
    const onEdit = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ProjectDetailsCard onEdit={onEdit} manager={{ name: 'Michaela Brown', email: 'm@x.test' }} project={{
          id: 'p1', priority: 'medium', category: 'web_development', projectType: 'web_application', methodology: 'hybrid',
          location: 'Jamaica', currency: 'usd', budgetAllocated: 100000, budgetSpent: 25000,
          startDate: '2026-11-02', endDate: '2026-12-18', clientId: 'c1',
        }} />
      </QueryClientProvider>,
    );
    for (const g of ['Who', 'When', 'Money', 'What']) expect(screen.getByRole('region', { name: g })).toBeTruthy();
    expect(await screen.findByText('DBJ Bank')).toBeTruthy();
    expect(await screen.findByText('Pat Sponsor')).toBeTruthy();
    expect(await screen.findByText('Jamaica 2026')).toBeTruthy();
    expect(screen.getByText('Michaela Brown')).toBeTruthy();
    expect(screen.getByText('Web development')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('$100,000')).toBeTruthy();
    expect(screen.getByText('m@x.test')).toBeTruthy(); // visible, not only on hover
    expect(screen.getByText('25% of budget')).toBeTruthy();
    screen.getByRole('button', { name: 'Edit project details' }).click();
    expect(onEdit).toHaveBeenCalled();
  });

  it('length counts working days on the project calendar (weekends and holidays off)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ProjectDetailsCard manager={null} project={{ id: 'p2', startDate: '2026-11-02', endDate: '2026-11-15' }} />
      </QueryClientProvider>,
    );
    // 2–15 Nov: 14 days, minus 2 weekends (4 days) and a holiday on the 11th = 9 working days
    expect(await screen.findByText(/9 working days/)).toBeTruthy();
  });

  it('no pencil for someone who cannot change the project', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProjectDetailsCard manager={null} project={{ id: 'p1' }} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Edit project details' })).toBeNull();
    expect(screen.getByText('Not assigned')).toBeTruthy();
  });
});
