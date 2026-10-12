import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * "Kovarti vs Microsoft Project vs Asana" (user OK 2026-10-12): honest and dated; our price from the
 * pricing settings (never typed into the page); nothing unconfirmed on it.
 */
const api = vi.hoisted(() => ({
  getPricingConfig: vi.fn(async () => ({ tiers: [
    { tier: 'trial', monthlyPriceCents: 0 },
    { tier: 'consultant_basic', monthlyPriceCents: 1900, annualPriceCents: 19000 },
    { tier: 'consultant_pro', monthlyPriceCents: 2900, annualPriceCents: 29000 },
  ] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/layout/PublicNavbar', () => ({ PublicNavbar: () => null }));
vi.mock('../../components/layout/PublicFooter', () => ({ PublicFooter: () => null }));

import { CompareMsProjectPage } from '../../pages/CompareMsProjectPage';

const show = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><CompareMsProjectPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe('comparison page', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('one h1, a dated table with column and row headers, and where the others win', async () => {
    show();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByText(/as of October 2026/).length).toBeGreaterThan(0);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Kovarti', 'Microsoft Project (Plan 3)', 'Asana (Advanced)']),
    );
    expect(within(table).getAllByRole('rowheader').length).toBeGreaterThan(10);
    expect(screen.getByRole('heading', { name: /Choose Microsoft Project if/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Choose Asana if/ })).toBeTruthy();
  });

  it("compares like with like: our lowest yearly price per month (from the pricing settings) beside their billed-yearly prices", async () => {
    show();
    expect(await screen.findByText(/from \$15\.83/)).toBeTruthy(); // $190 a year ÷ 12, not the $19 month-to-month price
    expect(screen.getByText(/\$30/)).toBeTruthy();
    expect(screen.getByText(/Starter \$10\.99 · Advanced \$24\.99/)).toBeTruthy();
  });

  it('nothing unconfirmed is published: no [check] placeholders; listed in the sitemap', () => {
    const page = readFileSync(join(__dirname, '../../pages/CompareMsProjectPage.tsx'), 'utf8');
    expect(page).not.toMatch(/\[check/i);
    const sitemap = readFileSync(join(__dirname, '../../../public/sitemap.xml'), 'utf8');
    expect(sitemap).toContain('https://kovarti.com/compare/ms-project');
  });

  it('pricing settings unavailable: no made-up price, just a link to pricing', async () => {
    api.getPricingConfig.mockRejectedValue(new Error('down')); // every try fails (the query retries once)
    show();
    expect(await screen.findByRole('link', { name: 'see pricing' })).toBeTruthy();
    expect(screen.queryByText(/from \$/)).toBeNull();
  });

  it("never says another product lacks something unless its own page says so — 'Not listed on its plan page' instead", () => {
    show();
    const table = screen.getByRole('table');
    expect(within(table).queryAllByText(/Not built in/i)).toHaveLength(0);
    expect(within(table).getAllByText('Not listed on its plan page').length).toBeGreaterThan(0);
  });
});
