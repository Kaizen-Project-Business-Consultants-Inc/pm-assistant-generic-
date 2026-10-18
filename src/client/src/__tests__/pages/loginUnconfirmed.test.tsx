import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Signing in before the email is confirmed (UAT 2026-10-17 review): the refusal offers a new
 * confirmation link right there, so someone who abandoned a paid checkout isn't stuck.
 */
const api = vi.hoisted(() => ({
  getAuthProviders: vi.fn(async () => ({ google: false })),
  login: vi.fn(),
  resendVerificationEmail: vi.fn(async () => ({ message: 'ok' })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));

import { LoginPage } from '../../pages/LoginPage';

const refused = (status: number, error: string) =>
  Object.assign(new Error('x'), { response: { status, data: { error, message: 'Please verify your email address before logging in.' } } });

function signIn(who: string) {
  render(<MemoryRouter initialEntries={['/login']}><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: who } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Right-password1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in with an unconfirmed email', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('offers a new confirmation link and sends it to the address typed', async () => {
    api.login.mockRejectedValueOnce(refused(403, 'Email not verified'));
    signIn('pat@acme.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Send me a new confirmation link' }));
    expect(await screen.findByText(/Sent — check pat@acme.test/)).toBeTruthy();
    expect(api.resendVerificationEmail).toHaveBeenCalledWith('pat@acme.test');
  });

  it('too many resends: says to wait', async () => {
    api.login.mockRejectedValueOnce(refused(403, 'Email not verified'));
    api.resendVerificationEmail.mockRejectedValueOnce({ response: { status: 429 } });
    signIn('pat@acme.test');
    fireEvent.click(await screen.findByRole('button', { name: 'Send me a new confirmation link' }));
    expect(await screen.findByText(/Please wait a few minutes/)).toBeTruthy();
  });

  it('another refusal (an expired guest) offers no link', async () => {
    api.login.mockRejectedValueOnce(refused(403, 'Guest access expired'));
    signIn('pat@acme.test');
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Send me a new confirmation link' })).toBeNull();
  });
});
