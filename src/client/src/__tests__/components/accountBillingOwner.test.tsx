/**
 * Account page (2026-10-08): billing belongs to the company owner — the server bills the owner's
 * own payment account and refuses seat changes from anyone else. Manage Billing, Buy More Tokens,
 * seats and View Plans show only for the owner (or the platform admin); others see the plan and
 * AI usage and are told who manages billing ("hide, don't disable").
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getSubscriptionStatus: vi.fn(),
  getTopUpBalance: vi.fn().mockResolvedValue({ remainingTokens: 0 }),
  getAiBudget: vi.fn().mockResolvedValue({ totalTokens: 10, budget: 100, percentUsed: 10, remaining: 90, requestCount: 1 }),
  getSeatInfo: vi.fn().mockResolvedValue({ billingModel: 'per_seat', usedSeats: 2, paidSeats: 3, availableSeats: 1, seatPriceCents: 1900 }),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { AccountBillingPage } from '../../pages/AccountBillingPage';
import { useAuthStore, type User } from '../../stores/authStore';
import { canManageBilling } from '../../hooks/useCanManageBilling';

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

  it('the platform admin (no company) may; nobody signed in may not', () => {
    expect(canManageBilling({ role: 'admin', organization: null } as User)).toBe(true);
    expect(canManageBilling({ role: 'admin', organization: { id: 'o', name: 'c', slug: 'c', isOwner: false } } as User)).toBe(false);
    expect(canManageBilling(null)).toBe(false);
  });
});
