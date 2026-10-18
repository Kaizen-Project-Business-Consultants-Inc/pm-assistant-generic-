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

  it('not paid yet (awaiting payment): the usual wording, no payment line', () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' });
    expect(screen.queryByText(/Payment received/)).toBeNull();
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

  it('Cancel closes the form without saving', () => {
    show({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete' });
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('New email address')).toBeNull();
    // focus moves after the form closes (next frame) — wait for it instead of reading at once (failed under load)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change it' })));
    expect(api.changePendingEmail).not.toHaveBeenCalled();
  });
});
