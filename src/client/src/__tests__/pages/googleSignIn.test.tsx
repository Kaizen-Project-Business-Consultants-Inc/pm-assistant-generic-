import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Sign in with Google, the screens (approved mock 2026-10-12): the button shows only when the
 * server has Google set up; it carries what the person was doing (sign-up plan, invitation); the
 * sign-in page explains every refusal; an existing account is linked only after its password or
 * an emailed link, and the link page names the account first.
 */
const api = vi.hoisted(() => ({
  getAuthProviders: vi.fn(async () => ({ google: true })),
  googleStartUrl: vi.fn((i: Record<string, unknown>) => `/api/v1/auth/google/start?${new URLSearchParams(i as Record<string, string>).toString()}`),
  validateInvite: vi.fn(async () => ({ valid: true, orgName: 'Acme', email: 'sam@acme.com' })),
  login: vi.fn(),
  register: vi.fn(),
  googleLinkPreview: vi.fn(async () => ({ account: 'jane@example.com', google: 'jane@example.com', hasPassword: true })),
  googleLinkWithPassword: vi.fn(async () => ({ ok: true })),
  googleLinkByEmail: vi.fn(async () => ({ message: 'Check your email for a link (valid 10 minutes).' })),
  googleLinkConfirm: vi.fn(async () => ({ ok: true })),
  getMe: vi.fn(async () => ({ user: { id: 'u1', fullName: 'Jane' } })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));

import { useAuthStore } from '../../stores/authStore';
import { LoginPage } from '../../pages/LoginPage';
import { RegisterPage } from '../../pages/RegisterPage';
import { LinkGooglePage } from '../../pages/LinkGooglePage';

const show = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/link-google" element={<LinkGooglePage />} />
      <Route path="/dashboard" element={<p>Dashboard</p>} />
    </Routes>
  </MemoryRouter>,
);
const googleLink = async (name: string) => (await screen.findByRole('link', { name })).getAttribute('href')!;

describe('Sign in with Google — screens', () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: null } as never); });
  afterEach(cleanup);

  it('no Google button when the server has no Google settings', async () => {
    api.getAuthProviders.mockResolvedValueOnce({ google: false });
    show('/login');
    await waitFor(() => expect(api.getAuthProviders).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('sign-in page: "Continue with Google", then the email form', async () => {
    show('/login');
    expect(await googleLink('Continue with Google')).toContain('mode=signin');
    expect(screen.getByText('or with your email')).toBeTruthy();
  });

  it('sign-up page: "Sign up with Google" carries the chosen plan and shows the terms', async () => {
    show('/register?tier=consultant_pro&billing=annual');
    const href = await googleLink('Sign up with Google');
    expect(href).toContain('mode=signup');
    expect(href).toContain('tier=consultant_pro');
    expect(href).toContain('plan=annual');
    expect(screen.getByText(/By continuing with Google you agree/)).toBeTruthy();
  });

  it('an invitation goes with the Google sign-up', async () => {
    show('/register?invite=tok');
    expect(await googleLink('Sign up with Google')).toContain('invite=tok');
  });

  it.each([
    ['cancelled', 'You cancelled at Google. Nothing was changed.'],
    ['unverified', "Google hasn't confirmed this email address."],
    ['switched-off', 'This account is switched off.'],
    ['expired', 'The sign-in took too long or was opened twice.'],
    ['busy', 'Kovarti is busy right now.'],
    ['something-new', 'Google did not finish the sign-in.'],
  ])('the sign-in page explains ?google=%s', async (code, text) => {
    show(`/login?google=${code}`);
    expect((await screen.findByRole('alert')).textContent).toContain(text);
  });

  it('a Google address with no account lands on sign-up with a note', async () => {
    show('/register?google=no-account');
    expect((await screen.findByRole('alert')).textContent).toMatch(/no Kovarti account for that Google address/);
  });

  it('link page: names the account, links with the password once, then opens the dashboard', async () => {
    show('/link-google?token=abc');
    expect(await screen.findByRole('heading', { name: 'You already have a Kovarti account' })).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your Kovarti password'), { target: { value: 'Right1234!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }));
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    expect(api.googleLinkWithPassword).toHaveBeenCalledWith('abc', 'Right1234!');
    expect(useAuthStore.getState().user).toMatchObject({ id: 'u1' });
  });

  it('link page: a wrong password says so and stays', async () => {
    api.googleLinkWithPassword.mockRejectedValueOnce({ response: { status: 401, data: { message: "That password isn't right. Try again, or have a link emailed to you." } } });
    show('/link-google?token=abc');
    fireEvent.change(await screen.findByLabelText('Your Kovarti password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain("That password isn't right");
    expect(screen.getByLabelText('Your Kovarti password')).toBeTruthy();
  });

  it('link page: "email me a link" instead', async () => {
    show('/link-google?token=abc');
    fireEvent.click(await screen.findByRole('button', { name: /Email me a link to link Google instead/ }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(api.googleLinkByEmail).toHaveBeenCalledWith('abc');
  });

  it('link page: an account with no password only offers the email', async () => {
    api.googleLinkPreview.mockResolvedValueOnce({ account: 'jane@example.com', google: 'jane@example.com', hasPassword: false });
    show('/link-google?token=abc');
    expect(await screen.findByRole('button', { name: 'Email me a link to link Google' })).toBeTruthy();
    expect(screen.queryByLabelText('Your Kovarti password')).toBeNull();
  });

  it('the emailed link opens a page that names both accounts; only its button links', async () => {
    api.googleLinkPreview.mockResolvedValueOnce({ account: 'jane@work.com', google: 'jane@gmail.com', hasPassword: true });
    show('/link-google?confirm=xyz');
    expect(await screen.findByRole('heading', { name: 'Link your Google account' })).toBeTruthy();
    expect(screen.getByText('jane@gmail.com')).toBeTruthy();
    expect(screen.getByText('jane@work.com')).toBeTruthy();
    expect(api.googleLinkConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }));
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    expect(api.googleLinkConfirm).toHaveBeenCalledWith('xyz');
  });

  it('signing in from an invitation sends the invitation with the Google button', async () => {
    show('/login?invite=tok');
    const href = await googleLink('Continue with Google');
    expect(href).toContain('mode=signin');
    expect(href).toContain('invite=tok');
  });

  it('a link page that cannot load for another reason says so and can try again', async () => {
    api.googleLinkPreview.mockRejectedValueOnce({ response: { status: 429, data: { message: 'Too many attempts. Please wait a minute and try again.' } } });
    show('/link-google?token=abc');
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.getByText('Too many attempts. Please wait a minute and try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'You already have a Kovarti account' })).toBeTruthy();
  });

  it('a link without its code says it is incomplete', async () => {
    show('/link-google');
    expect(await screen.findByText(/This link is incomplete/)).toBeTruthy();
    expect(api.googleLinkPreview).not.toHaveBeenCalled();
  });

  it('the password screen puts the cursor in the password box', async () => {
    show('/link-google?token=abc');
    const box = await screen.findByLabelText('Your Kovarti password');
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('after too many wrong passwords the link is gone: the expired screen', async () => {
    api.googleLinkWithPassword.mockRejectedValueOnce({ response: { status: 410, data: { message: 'This took too long. Please click "Continue with Google" again.' } } });
    show('/link-google?token=abc');
    fireEvent.change(await screen.findByLabelText('Your Kovarti password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link Google and sign in' }));
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
  });

  it('an email that could not be sent says so and the page stays', async () => {
    api.googleLinkByEmail.mockRejectedValueOnce({ response: { status: 503, data: { message: "We couldn't send the email just now." } } });
    show('/link-google?token=abc');
    fireEvent.click(await screen.findByRole('button', { name: /Email me a link to link Google instead/ }));
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't send the email just now.");
    expect(screen.getByLabelText('Your Kovarti password')).toBeTruthy();
  });

  it('a switched-off account on the emailed link is refused and nothing signs in', async () => {
    api.googleLinkConfirm.mockRejectedValueOnce({ response: { status: 403, data: { message: "This account cannot sign in. Ask your company's Kovarti owner." } } });
    show('/link-google?confirm=xyz');
    fireEvent.click(await screen.findByRole('button', { name: 'Link Google and sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cannot sign in');
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('a first sign-in after linking is remembered like a password sign-in', async () => {
    api.getMe.mockResolvedValueOnce({ user: { id: 'u1', fullName: 'Jane', isFirstLogin: true } } as never);
    sessionStorage.removeItem('pm-first-login');
    show('/link-google?confirm=xyz');
    fireEvent.click(await screen.findByRole('button', { name: 'Link Google and sign in' }));
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    expect(sessionStorage.getItem('pm-first-login')).toBe('true');
  });

  it('an expired link says so and goes back to sign in', async () => {
    api.googleLinkPreview.mockRejectedValueOnce({ response: { status: 410, data: { message: 'This link has expired or was used already.' } } });
    show('/link-google?confirm=old');
    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy();
  });
});
