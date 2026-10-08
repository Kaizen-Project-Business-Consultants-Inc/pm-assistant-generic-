/**
 * Pricing page (2026-10-08): only the company owner (or the platform admin) buys a plan, AI
 * top-ups or opens the billing portal — the server answers 403 to anyone else. A signed-in member
 * who isn't the owner sees the plans but no buy / switch / top-up / billing buttons, and is told
 * who manages it ("hide, don't disable"). Signed-out visitors and the owner see the page as before.
 * A refusal that still reaches a button is shown, not swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getPricingConfig: vi.fn(),
  request: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  createTopUpSession: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { PricingSection } from '../../components/pricing/PricingCards';
import { useAuthStore, type User } from '../../stores/authStore';

const OWNER_LINE = "Your company's owner manages the plan, payment and AI top-ups.";

function signIn(role: User['role'], isOwner: boolean, tier = 'consultant_pro') {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: 'u1', username: 'u', email: 'u@x', fullName: 'Q', role,
      subscriptionTier: tier, subscriptionStatus: 'active',
      organization: { id: 'o', name: 'Co', slug: 'co', isOwner },
    } as User,
  });
}

function renderPricing() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={qc}><PricingSection mode="checkout" forceDark /></QueryClientProvider></MemoryRouter>);
}

/** A 403 shaped like the server's billingOwnerOnly reply, as axios surfaces it */
function refused(message: string) {
  return Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message } } });
}

beforeEach(() => {
  // No pricing config from the server: the built-in plan list is used
  api.getPricingConfig.mockRejectedValue(new Error('offline'));
  api.request.mockResolvedValue({ enabledTiers: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); useAuthStore.setState({ user: null, isAuthenticated: false }); });

describe('Pricing page billing buttons', () => {
  it('a signed-in team member sees the plans and who manages them, but no buy, top-up or billing buttons', async () => {
    signIn('team_member', false);
    renderPricing();
    expect(await screen.findAllByText(OWNER_LINE)).toHaveLength(2); // above the plans and in the top-up box
    expect(screen.queryByRole('button', { name: /Subscribe|Switch Plan|Get Started/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Buy Token Pack/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Current Plan' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start Free Trial' })).toBeNull();
    // Still told which plan the company is on — as text, not a button
    expect(screen.getByText('Current Plan').tagName).toBe('P');
  });

  it('a PMO who is not the owner gets no buttons either', async () => {
    signIn('pmo', false);
    renderPricing();
    expect(await screen.findAllByText(OWNER_LINE)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Switch Plan|Buy Token Pack|Current Plan/ })).toBeNull();
  });

  it('the owner sees the page unchanged: switch plan, current plan (billing portal) and top-up', async () => {
    signIn('pmo', true);
    renderPricing();
    expect((await screen.findAllByRole('button', { name: 'Switch Plan' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Current Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Buy Token Pack/ })).toBeTruthy();
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });

  it('the platform admin (no company) sees the buttons', async () => {
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'a', username: 'a', email: 'a@x', fullName: 'A', role: 'admin', organization: null } as User });
    renderPricing();
    expect((await screen.findAllByRole('button', { name: 'Subscribe' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buy Token Pack/ })).toBeTruthy();
  });

  it('someone signed in with no company (their company was never made) pays for themselves, as the server allows', async () => {
    useAuthStore.setState({ isAuthenticated: true, user: { id: 's', username: 's', email: 's@x', fullName: 'S', role: 'project_manager', subscriptionTier: 'trial', organization: null } as User });
    renderPricing();
    expect((await screen.findAllByRole('button', { name: 'Subscribe' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buy Token Pack/ })).toBeTruthy();
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });

  it('a signed-out visitor sees the page unchanged', async () => {
    renderPricing();
    expect((await screen.findAllByRole('button', { name: 'Get Started' })).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Buy Token Pack/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start Free Trial' })).toBeTruthy();
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });

  it("a refused top-up shows the server's message instead of doing nothing", async () => {
    signIn('pmo', true);
    api.createTopUpSession.mockRejectedValue(refused('Only the company owner can buy AI credits.'));
    renderPricing();
    fireEvent.click(await screen.findByRole('button', { name: /Buy Token Pack/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Only the company owner can buy AI credits.');
  });

  it("a refused billing portal shows the server's message instead of doing nothing", async () => {
    signIn('pmo', true);
    api.createPortalSession.mockRejectedValue(refused('Only the company owner can open billing.'));
    renderPricing();
    fireEvent.click(await screen.findByRole('button', { name: 'Current Plan' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Only the company owner can open billing.');
  });
});
