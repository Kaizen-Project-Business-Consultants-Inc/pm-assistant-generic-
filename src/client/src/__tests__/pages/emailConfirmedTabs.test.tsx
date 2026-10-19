import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * U45 (approved mock 2026-10-19): the confirm link opens a new tab, which carries on into Kovarti;
 * the "check your email" tab left open says "You're confirmed — Kovarti is open in the other tab"
 * instead of moving on too. A link opened in another browser sends nothing: the tab moves on.
 */
const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  verifyEmail: vi.fn(async () => ({ message: 'Email verified successfully!' })),
  resendVerificationEmail: vi.fn(),
  changePendingEmail: vi.fn(),
  reconcileSubscription: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { VerifyEmailPendingPage } from '../../pages/VerifyEmailPendingPage';
import { VerifyEmailPage } from '../../pages/VerifyEmailPage';
import { announceEmailConfirmed } from '../../utils/emailConfirmedSignal';

const user = { id: 'u1', username: 'pat', email: 'pat@acme.test', fullName: 'Pat', role: 'pmo', subscriptionTier: 'trial', subscriptionStatus: 'active' };

const at = (path: string, page: React.ReactElement) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={path.split('?')[0]} element={page} />
      <Route path="/dashboard" element={<p>Dashboard</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('confirming the email with two tabs open (U45)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { ...user, emailVerified: false }, isAuthenticated: true } as never);
  });
  afterEach(cleanup);

  it('the waiting tab says "You\'re confirmed" when the other tab confirms, and can still continue', async () => {
    api.getMe.mockResolvedValue({ user: { ...user, emailVerified: false } });
    at('/verify-email-pending', <VerifyEmailPendingPage />);
    await waitFor(() => expect(api.getMe).toHaveBeenCalled());

    api.getMe.mockResolvedValue({ user: { ...user, emailVerified: true } });
    act(() => announceEmailConfirmed());
    expect(await screen.findByRole('heading', { name: "You're confirmed" })).toBeTruthy();
    expect(screen.getByText('Kovarti is open in the other tab. You can close this one.')).toBeTruthy();
    expect(screen.queryByText('Dashboard')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue here instead' }));
    expect(await screen.findByText('Dashboard')).toBeTruthy();
  });

  it('confirmed in another browser (no message): the waiting tab moves on by itself', async () => {
    api.getMe.mockResolvedValue({ user: { ...user, emailVerified: true } });
    at('/verify-email-pending', <VerifyEmailPendingPage />);
    expect(await screen.findByText('Dashboard')).toBeTruthy();
  });

  it('the link\'s tab, signed in, carries straight on to the dashboard', async () => {
    api.getMe.mockResolvedValue({ user: { ...user, emailVerified: true } });
    at('/verify-email?token=t1', <VerifyEmailPage />);
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    expect(api.verifyEmail).toHaveBeenCalledWith('t1');
  });
});
