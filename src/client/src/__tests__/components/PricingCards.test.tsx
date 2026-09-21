import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getPricingConfig: vi.fn(),
  request: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: () => ({ isAuthenticated: false, user: null }),
}));

import { PricingCards } from '../../components/pricing/PricingCards';

/** Shaped like the live /pricing response, which is where plans really come from. */
const apiTiers = [
  { tier: 'trial', displayName: 'Free Trial', monthlyPriceCents: 0, annualPriceCents: 0, aiTokensLabel: '5K', storageLabel: '100MB', viewerLimitLabel: '0', featuresJson: [], isPerSeat: false, minSeats: 1 },
  { tier: 'consultant_basic', displayName: 'Consultant Basic', monthlyPriceCents: 1900, annualPriceCents: 19000, aiTokensLabel: '—', storageLabel: '1GB', viewerLimitLabel: '5', featuresJson: ['Full PM'], isPerSeat: false, minSeats: 1 },
  { tier: 'consultant_pro', displayName: 'Consultant Pro', monthlyPriceCents: 2900, annualPriceCents: 29000, aiTokensLabel: '500K', storageLabel: '1GB', viewerLimitLabel: '15', featuresJson: ['AI'], isPerSeat: false, minSeats: 1, highlight: true },
  { tier: 'sme', displayName: 'Team', highlight: true, monthlyPriceCents: 1900, annualPriceCents: 19000, aiTokensLabel: '500K', storageLabel: '5GB', viewerLimitLabel: 'Unlimited', featuresJson: ['Everything in Pro'], isPerSeat: true, minSeats: 3 },
  { tier: 'enterprise', displayName: 'Enterprise', monthlyPriceCents: 7900, annualPriceCents: 79000, aiTokensLabel: '2M', storageLabel: '20GB', viewerLimitLabel: 'Unlimited', featuresJson: ['Everything'], isPerSeat: false, minSeats: 1 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PricingCards mode="link" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the pricing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPricingConfig.mockResolvedValue({ tiers: apiTiers });
    api.request.mockResolvedValue({
      publishableKey: 'pk_test',
      enabledTiers: ['consultant_basic', 'consultant_pro', 'sme', 'enterprise'],
    });
  });

  afterEach(cleanup);

  it('offers Team, the only plan a firm can buy', async () => {
    // It was hidden, which contradicted the positioning: a consultancy with more
    // than one PM is meant to buy per-seat and could not see it.
    renderPage();

    await waitFor(() => expect(screen.getByText('Team')).toBeTruthy());
  });

  it('does not offer Enterprise, which is not ready to sell', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Consultant Pro')).toBeTruthy());
    expect(screen.queryByText('Enterprise')).toBeNull();
  });

  it('says who each plan is for', async () => {
    // A firm should recognise its own plan without having to ask.
    renderPage();

    await waitFor(() => expect(screen.getByText(/Consultancies with more than one PM/i)).toBeTruthy());
    expect(screen.getByText(/One consultant, with AI/i)).toBeTruthy();
  });

  it('never shows "Most Popular" on more than one card', async () => {
    // Both Pro and Team were flagged in the pricing table. It went unnoticed
    // while Team was hidden; showing Team put two badges on the page, which
    // tells a buyer nothing and reads as a mistake.
    renderPage();

    await waitFor(() => expect(screen.getByText('Team')).toBeTruthy());
    expect(screen.getAllByText('Most Popular')).toHaveLength(1);
  });

  it('prices Team per person and enforces the minimum', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Team')).toBeTruthy());
    expect(screen.getByText(/USD\/seat/i)).toBeTruthy();
    expect(screen.getByText(/3\+ min/i)).toBeTruthy();
  });

  it('keeps the audience line when plans come from the API, not local defaults', async () => {
    // Plans are API-driven in production. A line held only on the local
    // fallbacks would never be seen by a real visitor.
    renderPage();

    await waitFor(() => expect(screen.getByText('Team')).toBeTruthy());
    expect(screen.getByText(/Priced per person/i)).toBeTruthy();
  });
});
