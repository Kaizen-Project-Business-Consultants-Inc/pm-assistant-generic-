import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Setup step 1 (UAT 2026-10-17): no "Preferred Methodology" question (a project's methodology comes
 * from its template), and name / company are asked only when sign-up didn't give them.
 */
const api = vi.hoisted(() => ({
  getProjectGroups: vi.fn(async () => ({ groups: [] })),
  getSampleProject: vi.fn(async () => ({ canManage: false, loaded: false })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { OnboardingPage } from '../../pages/OnboardingPage';

const base = { id: 'u1', username: 'pat', email: 'pat_m@acme.test', role: 'pmo', emailVerified: true, onboardingCompleted: false };
function show(user: Record<string, unknown>) {
  useAuthStore.setState({ user: { ...base, ...user } } as never);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><OnboardingPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingPage step 1', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  it('asks no methodology question', () => {
    show({ fullName: '', subscriptionTier: 'trial' });
    expect(screen.queryByText(/Methodology/i)).toBeNull();
    expect(screen.queryByText('Waterfall', { exact: true })).toBeNull();
    expect(screen.queryByText('Agile', { exact: true })).toBeNull();
  });

  it('a sign-up with no name and a company named after the email: both are asked', () => {
    show({ fullName: '', subscriptionTier: 'trial', organization: { id: 'o', name: 'pat_m', slug: 'pat-m', isOwner: true } });
    expect(screen.getByLabelText('Full Name')).toBeTruthy();
    expect(screen.getByLabelText(/Organization Name/)).toBeTruthy();
  });

  it('a company named after its owner was never named: still asked, the name is not', () => {
    show({ fullName: 'Pat Moore', subscriptionTier: 'trial', organization: { id: 'o', name: 'Pat Moore', slug: 'pat', isOwner: true } });
    expect(screen.queryByLabelText('Full Name')).toBeNull();
    expect(screen.getByLabelText(/Organization Name/)).toBeTruthy();
  });

  it('a paid sign-up that gave both: neither is asked again', () => {
    show({ fullName: 'Pat Moore', subscriptionTier: 'sme', subscriptionStatus: 'active', organization: { id: 'o', name: 'Moore Consulting', slug: 'moore', isOwner: true } });
    expect(screen.queryByLabelText('Full Name')).toBeNull();
    expect(screen.queryByLabelText(/Organization Name/)).toBeNull();
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy();
  });
});
