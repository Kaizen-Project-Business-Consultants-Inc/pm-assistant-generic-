/**
 * Audit 2 medium/low accessibility fixes that a test can pin down:
 *  - M6 the time Utilization heatmap is a table to screen readers, with exact figures, and >100%
 *    is marked by shape as well as colour;
 *  - L2 the client breadcrumb is a list, its link is underlined, the last crumb is the current page;
 *  - L1 the pinned project's "Open schedule" button is no longer inside the link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('../../services/api', () => ({
  apiService: {
    getUtilizationHeatmap: vi.fn().mockResolvedValue({
      heatmap: {
        users: [{ userId: 'u1', userName: 'Ada' }],
        dates: ['2026-10-05', '2026-10-06'],
        cells: [
          { userId: 'u1', date: '2026-10-05', hours: 6.5, utilization: 81 },
          { userId: 'u1', date: '2026-10-06', hours: 10, utilization: 125 },
        ],
        summary: [{ userId: 'u1', userName: 'Ada', avgHours: 8.3, avgUtilization: 103 }],
      },
    }),
    getFavouriteProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p1', name: 'Apollo' }] }),
    getAiBudget: vi.fn().mockResolvedValue({ percentUsed: 0 }),
  },
}));

import { UtilizationHeatmap } from '../../components/timetracking/UtilizationHeatmap';
import { ClientBreadcrumb } from '../../pages/clients/ClientBreadcrumb';
import Sidebar from '../../components/layout/Sidebar';
import { useAuthStore, type User } from '../../stores/authStore';

afterEach(() => { cleanup(); useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false }); });

function signInPm() {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'pm', email: 'pm@x', fullName: 'Pat Manager', role: 'project_manager', emailVerified: true,
      organization: { id: 'o1', name: 'Co', slug: 'co', isOwner: true },
    } as User,
    isAuthenticated: true,
    isLoading: false,
  });
}

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('Utilization heatmap semantics (M6)', () => {
  it('is a table with person row headers, date column headers and exact figures per cell', async () => {
    wrap(<UtilizationHeatmap projectId="p1" />);
    const table = await screen.findByRole('table', { name: 'Utilization by person and day' });
    expect(within(table).getByRole('rowheader', { name: 'Ada' })).toBeTruthy();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3); // Person + 2 days
    const cells = within(table).getAllByRole('cell');
    expect(cells.map(c => c.querySelector('.sr-only')!.textContent)).toEqual(['6.5 hours, 81%', '10.0 hours, 125%']);
  });

  it('marks a day over 100% with a shape, not only a darker red', async () => {
    wrap(<UtilizationHeatmap projectId="p1" />);
    const cells = await screen.findAllByRole('cell');
    expect(cells[0].textContent).not.toContain('▲');
    expect(cells[1].textContent).toContain('▲');
  });

  it('its horizontal scroller is keyboard-focusable and named', async () => {
    wrap(<UtilizationHeatmap projectId="p1" />);
    const region = await screen.findByRole('region', { name: 'Utilization heatmap' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('overflow-x-auto');
  });

  it('every grey label, date header and the legend has a readable dark-mode colour', async () => {
    const { container } = wrap(<UtilizationHeatmap projectId="p1" />);
    await screen.findByRole('table');
    const greys = Array.from(container.querySelectorAll<HTMLElement>('[class*="text-gray-4"],[class*="text-gray-5"]'))
      .filter(el => /(^|\s)text-gray-[45]00(\s|$)/.test(el.className));
    expect(greys.length).toBeGreaterThan(4); // From, To, date headers, legend...
    for (const el of greys) expect(el.className).toMatch(/dark:text-gray-(300|400)/);
  });
});

describe('Client breadcrumb (L2)', () => {
  it('is a list; the link is underlined; the client crumb is the current page', () => {
    signInPm();
    wrap(<ClientBreadcrumb name="Acme" />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
    expect(within(nav).getByRole('link', { name: 'Clients' }).className).toMatch(/\bunderline\b/);
    expect(within(nav).getByText('Acme').getAttribute('aria-current')).toBe('page');
  });
});

describe('Pinned project (L1)', () => {
  it('"Open schedule" is a named button beside the link, not inside it', async () => {
    signInPm();
    wrap(<Sidebar collapsed={false} onToggle={() => {}} />);
    const link = await screen.findByRole('link', { name: 'Apollo' });
    const button = screen.getByRole('button', { name: 'Open schedule: Apollo' });
    expect(link.contains(button)).toBe(false);
  });
});
