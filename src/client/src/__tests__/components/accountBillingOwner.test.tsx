/**
 * Account page (2026-10-08): billing belongs to the company owner — the server bills the owner's
 * own payment account and refuses seat changes from anyone else. Manage Billing, Buy More Tokens,
 * seats and View Plans show only for the owner (or the platform admin); others see the plan and
 * AI usage and are told who manages billing ("hide, don't disable").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Exactly what GET /stripe/topup-balance sends (routes/integrations/stripe.ts, keys camelCased by
 * the server): the balance is `remainingTopUpTokens`. The page read `remainingTokens`, which the
 * server never sends, so every owner saw 0 bonus tokens.
 */
const TOPUP_REPLY = vi.hoisted((): TopUpBalance => ({
  remainingTopUpTokens: 1_500_000,
  topUpConfig: { tokensPerPack: 500_000, pricePerPack: 1000 },
  history: [{ id: 't1', tokensPurchased: 500_000, tokensRemaining: 500_000, amountCents: 1000, purchasedAt: '2026-10-01T00:00:00.000Z', expiresAt: null }],
}));
const api = vi.hoisted(() => ({
  getSubscriptionStatus: vi.fn(),
  getTopUpBalance: vi.fn().mockResolvedValue(TOPUP_REPLY),
  getAiBudget: vi.fn().mockResolvedValue({ totalTokens: 10, budget: 100, percentUsed: 10, remaining: 90, requestCount: 1 }),
  getSeatInfo: vi.fn().mockResolvedValue({ billingModel: 'per_seat', usedSeats: 2, paidSeats: 3, availableSeats: 1, seatPriceCents: 1900 }),
  createPortalSession: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { AccountBillingPage } from '../../pages/AccountBillingPage';
import { useAuthStore, type User } from '../../stores/authStore';
import { canManageBilling } from '../../hooks/useCanManageBilling';
import type { TopUpBalance } from '../../services/apiAreas/billing';

afterEach(() => { cleanup(); api.getSubscriptionStatus.mockReset(); api.getSeatInfo.mockClear(); api.getTopUpBalance.mockClear(); useAuthStore.setState({ user: null, isAuthenticated: false }); });

function signIn(role: User['role'], isOwner: boolean) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: 'u1', username: 'u', email: 'u@x', fullName: 'Q', role, organization: { id: 'o', name: 'Co', slug: 'co', isOwner } } as User,
  });
}

async function renderPage(tier: string, status = 'active') {
  api.getSubscriptionStatus.mockResolvedValue({ tier, status, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={qc}><AccountBillingPage /></QueryClientProvider></MemoryRouter>);
  await screen.findByText('Account & Billing');
}

describe('Account page billing buttons', () => {
  it('the owner (who works as PMO) sees Manage Billing, Buy More Tokens and the seats', async () => {
    signIn('pmo', true);
    await renderPage('sme');
    expect(await screen.findByText('Add Seat')).toBeTruthy();
    expect(screen.getByText('Manage Billing')).toBeTruthy();
    expect(screen.getByText('Buy More Tokens')).toBeTruthy();
  });

  it('a team member sees the plan and usage, no billing buttons, and who manages it', async () => {
    signIn('team_member', false);
    await renderPage('sme');
    expect(await screen.findByText('AI Usage This Month')).toBeTruthy();
    expect(screen.queryByText('Manage Billing')).toBeNull();
    expect(screen.queryByText('Buy More Tokens')).toBeNull();
    expect(screen.queryByText('Add Seat')).toBeNull();
    expect(screen.getByText(/owner manages the plan/)).toBeTruthy();
    expect(api.getSeatInfo).not.toHaveBeenCalled();
    expect(api.getTopUpBalance).not.toHaveBeenCalled();
  });

  it('a PMO who is not the owner gets no billing buttons either; unpaid shows no View Plans', async () => {
    signIn('pmo', false);
    await renderPage('trial', 'trialing');
    expect(screen.queryByText(/View Plans/)).toBeNull();
    expect(screen.getByText(/owner manages the plan/)).toBeTruthy();
  });

  it('shows the bonus tokens the server reports (remainingTopUpTokens), not 0', async () => {
    signIn('pmo', true);
    await renderPage('consultant_pro');
    expect(await screen.findByText('1.5M')).toBeTruthy();
    expect(screen.getByText('Bonus tokens remaining')).toBeTruthy();
  });

  it("a refused Manage Billing shows the server's message instead of doing nothing", async () => {
    signIn('pmo', true);
    api.createPortalSession.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { message: 'Only the company owner can open billing.' } } }));
    await renderPage('consultant_pro');
    fireEvent.click(screen.getByText('Manage Billing'));
    expect((await screen.findByRole('alert')).textContent).toContain('Only the company owner can open billing.');
  });

  it('the platform admin (no company) may; nobody signed in may not', () => {
    expect(canManageBilling({ role: 'admin', organization: null } as User)).toBe(true);
    expect(canManageBilling({ role: 'admin', organization: { id: 'o', name: 'c', slug: 'c', isOwner: false } } as User)).toBe(false);
    expect(canManageBilling(null)).toBe(false);
    // No company at all (signup whose company was never made): pays for themselves, like the server allows
    expect(canManageBilling({ role: 'project_manager', organization: null } as User)).toBe(true);
    // Company not known yet (an old saved user without the field): stays hidden until /auth/me says
    expect(canManageBilling({ role: 'project_manager' } as User)).toBe(false);
  });
});
