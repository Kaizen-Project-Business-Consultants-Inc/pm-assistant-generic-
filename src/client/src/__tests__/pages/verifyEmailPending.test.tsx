import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The confirm-your-email page (UAT 2026-10-17): a paid sign-up arrives here straight after
 * paying, so it leads with "Payment received"; "Wrong address? Change it" replaced "Register again".
 */
const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  resendVerificationEmail: vi.fn(async () => ({ message: 'sent' })),
  changePendingEmail: vi.fn(),
  reconcileSubscription: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { VerifyEmailPendingPage } from '../../pages/VerifyEmailPendingPage';

const base = { id: 'u1', username: 'pat', email: 'pat@acme.tset', fullName: 'Pat', role: 'pmo', emailVerified: false } as const;
function show(user: Record<string, unknown>) {
  useAuthStore.setState({ user: { ...base, ...user } } as never);
  api.getMe.mockResolvedValue({ user: { ...base, ...user } });
  return render(<MemoryRouter><VerifyEmailPendingPage /></MemoryRouter>);
}

describe('VerifyEmailPendingPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  it('paid and active: "Payment received · <plan>" and "One last step"', () => {
    show({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active' });
    expect(screen.getByText(/Payment received · Consultant Pro/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'One last step: confirm your email' })).toBeTruthy();
    expect(screen.getByText(/This page moves on by itself once you have/)).toBeTruthy();
    expect(screen.getByText('pat@acme.tset')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resend/ })).toBeTruthy();
  });

  it('not paid yet: "Checking your payment…", then "Finish your payment" — never "we sent a link" (U41)', async () => {
    let settle!: () => void;
    api.reconcileSubscription.mockImplementationOnce(() => new Promise((r) => { settle = () => r({}); }));
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' });
    expect(screen.getByRole('heading', { name: 'Checking your payment…' })).toBeTruthy();
    expect(screen.queryByText(/We sent a verification link/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
    settle();
    expect(await screen.findByRole('heading', { name: 'Finish your payment' })).toBeTruthy();
    expect(screen.getByText(/your Consultant Pro plan isn.t paid yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose your plan and pay' }).getAttribute('href')).toBe('/pricing');
    expect(screen.queryByText(/We sent a verification link/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
    expect(screen.queryByText(/Payment received/)).toBeNull();
  });

  it('not paid, then the payment comes through: "Payment received" and Resend come back', async () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' });
    expect(await screen.findByRole('heading', { name: 'Finish your payment' })).toBeTruthy();
    useAuthStore.setState({ user: { ...base, subscriptionTier: 'consultant_pro', subscriptionStatus: 'active', pendingTier: null } } as never);
    expect(await screen.findByRole('heading', { name: 'One last step: confirm your email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resend/ })).toBeTruthy();
  });

  it('not paid and Stripe cannot be asked: still "Finish your payment", no Resend', async () => {
    api.reconcileSubscription.mockRejectedValueOnce(new Error('down'));
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'sme' });
    expect(await screen.findByRole('heading', { name: 'Finish your payment' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
  });

  it('not paid, "Change it": shows what the server said (no link sent yet)', async () => {
    api.changePendingEmail.mockResolvedValueOnce({ email: 'pat@acme.test', message: "Changed to pat@acme.test. We'll send your confirm link there once you've paid." });
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' });
    await screen.findByRole('heading', { name: 'Finish your payment' });
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'pat@acme.test' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Changed to pat@acme.test\. We.ll send your confirm link there once you.ve paid\./)).toBeTruthy();
    expect(screen.queryByText('Sent to pat@acme.test')).toBeNull();
  });

  it('no plan waiting (free sign-up): the usual wording with Resend', () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'trialing' });
    expect(screen.getByRole('heading', { name: 'Verify Your Email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resend/ })).toBeTruthy();
  });

  it('no "Register again" any more', () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'trialing' });
    expect(screen.queryByText(/Register again/)).toBeNull();
    expect(screen.queryByText(/Payment received/)).toBeNull();
  });

  it('"Wrong address? Change it" saves the new address and says where it went', async () => {
    api.changePendingEmail.mockResolvedValueOnce({ message: 'Sent to pat@acme.test', email: 'pat@acme.test' });
    show({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active' });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(''); // mounted empty, so the change is announced
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('New email address')));
    fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'pat@acme.test' } });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // needs the password too
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.click(save);

    await waitFor(() => expect(api.changePendingEmail).toHaveBeenCalledWith('pat@acme.test', 'my-password'));
    expect(await screen.findByText('Sent to pat@acme.test')).toBe(status);
    expect(useAuthStore.getState().user?.email).toBe('pat@acme.test');
    expect(screen.queryByLabelText('New email address')).toBeNull();
    // focus moves after the form closes (next frame) — wait for it instead of reading at once (failed under load)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change it' })));
  });

  it('awaiting payment: asks Stripe once on arrival (the webhook may be late)', async () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' });
    await waitFor(() => expect(api.reconcileSubscription).toHaveBeenCalledTimes(1));
  });

  it('already paid: no extra check with Stripe', async () => {
    show({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active' });
    await waitFor(() => expect(api.getMe).toHaveBeenCalled());
    expect(api.reconcileSubscription).not.toHaveBeenCalled();
  });

  it('a refused address keeps the form open with the reason', async () => {
    api.changePendingEmail.mockRejectedValueOnce({ response: { status: 409, data: { message: 'That address already has a Kovarti account. Use a different one.' } } });
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete' });
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    fireEvent.change(screen.getByLabelText('New email address'), { target: { value: 'taken@acme.test' } });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a Kovarti account/);
    expect(screen.getByLabelText('New email address')).toBeTruthy();
  });

  it('Cancel closes the form without saving', async () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete' });
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New email address')).toBeNull();
    // focus moves after the form closes (next frame) — wait for it instead of reading at once (failed under load)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change it' })));
    expect(api.changePendingEmail).not.toHaveBeenCalled();
  });
});
