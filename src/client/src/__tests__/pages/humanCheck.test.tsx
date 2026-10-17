import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Sign-in and forgot password (approved mock 2026-10-17): Cloudflare's "are you a person" box
 * appears only once the server says so (3 wrong passwords / 3 reset requests), the button
 * waits for its tick, and the token goes with the next try.
 */
const api = vi.hoisted(() => ({
  getAuthProviders: vi.fn(async () => ({ google: false })),
  login: vi.fn(),
  forgotPassword: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
// The real widget loads Cloudflare's script; this one ticks when its button is pressed
vi.mock('../../components/auth/TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken, onUnavailable }: { onToken: (t: string) => void; onUnavailable: () => void }) => (
    <>
      <button type="button" onClick={() => onToken('tok-1')}>Cloudflare check</button>
      <button type="button" onClick={onUnavailable}>Simulate blocked script</button>
    </>
  ),
}));

import { LoginPage } from '../../pages/LoginPage';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';

const show = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/dashboard" element={<p>Dashboard</p>} />
    </Routes>
  </MemoryRouter>,
);
const refused = (needsHumanCheck: boolean, message = 'Username or password is incorrect') =>
  Object.assign(new Error('x'), { response: { status: 401, data: { message, needsHumanCheck } } });

describe('the human check on the sign-in pages', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('no box on a normal wrong password', async () => {
    api.login.mockRejectedValueOnce(refused(false));
    show('/login');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Username or password is incorrect');
    expect(screen.queryByRole('button', { name: 'Cloudflare check' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('when the server asks, the box shows, Sign in waits for its tick, and the token goes with the try', async () => {
    api.login.mockRejectedValueOnce(refused(true)).mockResolvedValueOnce({ user: { id: 'u1', onboardingCompleted: true } });
    show('/login');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Right-password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const box = await screen.findByRole('button', { name: 'Cloudflare check' });
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.login).toHaveBeenLastCalledWith('sam', 'Right-password1', 'tok-1'));
  });

  it('a box that cannot load is explained, not left as a silent greyed-out button', async () => {
    api.login.mockRejectedValueOnce(refused(true));
    show('/login');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Checking you are a person…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' }).getAttribute('aria-describedby')).toBe('human-check-status');
    fireEvent.click(screen.getByRole('button', { name: 'Simulate blocked script' }));
    expect(await screen.findByText(/security check could not load/)).toBeTruthy();
  });

  it('forgot password: the box shows when asked and the token goes with the next request', async () => {
    api.forgotPassword.mockRejectedValueOnce(refused(true, 'Please complete the check below, then try again.')).mockResolvedValueOnce({});
    show('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cloudflare check' }));
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(api.forgotPassword).toHaveBeenLastCalledWith('sam@acme.test', 'tok-1'));
  });
});
