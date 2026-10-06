// @vitest-environment happy-dom
/**
 * Dashboard "Change Requests" widget (fixed 2026-10-06). The server camelCases every response
 * key, including the keys of the per-status count map, so 'in_review' arrives as 'inReview'. The
 * widget read `byStatus.in_review`, so "Awaiting Review (N)" left out every request In Review,
 * and the chip read "InReview" with no colour.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const getDashboardCRSummary = vi.fn();
vi.mock('../../services/api', () => ({
  apiService: { getDashboardCRSummary: (...a: unknown[]) => getDashboardCRSummary(...a) },
}));

import { ChangeRequestWidget } from '../../components/dashboard/widgets/ChangeRequestWidget';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ChangeRequestWidget', () => {
  it('counts In Review requests as awaiting review and labels the chip "In Review"', async () => {
    // exactly what the API sends after camelCasing { pending: 2, in_review: 3, approved: 1 }
    getDashboardCRSummary.mockResolvedValue({
      byStatus: { pending: 2, inReview: 3, approved: 1 },
      byCategory: {},
      recentPending: [{ id: 'c1', title: 'Add SSO', priority: 'high', projectName: 'DBJ', projectId: 'p1', daysWaiting: 4 }],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}><ChangeRequestWidget /></QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Awaiting Review (5)')).toBeTruthy();
    const chip = screen.getByText('In Review: 3');
    expect(chip.className).toContain('bg-blue-100');
  });
});
