import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The shorter sign-up form (2026-10-11): 84 people opened it in 11 days and 1 finished. No
 * Username (people sign in with their email; the server makes a username) and no second password
 * box (the show/hide eye checks what was typed). Name, work email, optional company, password,
 * terms. Invite and paid-plan sign-ups keep their own headings.
 */
const api = vi.hoisted(() => ({
  register: vi.fn(async () => ({ message: 'ok' })),
  validateInvite: vi.fn(async () => ({ valid: true, orgName: 'Acme', email: 'sam@acme.com' })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));
vi.mock('../../components/auth/CheckYourEmail', () => ({ CheckYourEmail: ({ email }: { email: string }) => <p>Check {email}</p> }));

import { useAuthStore } from '../../stores/authStore';
import { RegisterPage } from '../../pages/RegisterPage';

const show = (path = '/register') => render(<MemoryRouter initialEntries={[path]}><RegisterPage /></MemoryRouter>);

describe('sign-up form: four fields', () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: null } as never); });
  afterEach(cleanup);

  it('asks for name, work email, optional company and one password — no username, no second password', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Start your free 7-day trial' })).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByText("You'll sign in with this.")).toBeTruthy();
    expect(screen.getByLabelText(/Company/)).toBeTruthy();
    expect(screen.getAllByLabelText('Password')).toHaveLength(1);
    expect(screen.queryByLabelText(/Username/i)).toBeNull();
    expect(screen.queryByLabelText(/Confirm/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Start my free trial' })).toBeTruthy();
  });

  it('sends no username; the button waits for the terms box and a password', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jane Smith' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'jane@company.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    const button = screen.getByRole('button', { name: 'Start my free trial' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
    const sent = (api.register.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ fullName: 'Jane Smith', email: 'jane@company.com', password: 'longenough1' });
    expect(sent).not.toHaveProperty('username');
    expect(await screen.findByText('Check jane@company.com')).toBeTruthy();
  });

  it('an invite keeps its own heading and button, and has no company field', async () => {
    show('/register?invite=tok');
    expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept Invitation' })).toBeTruthy();
    expect(screen.queryByLabelText(/Company/)).toBeNull();
    expect(screen.queryByLabelText(/Username/i)).toBeNull();
  });

  it('an invite that is no longer valid promises no trial', async () => {
    api.validateInvite.mockResolvedValueOnce({ valid: false } as never);
    show('/register?invite=old');
    expect(await screen.findByText('This invitation link is invalid or has expired.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.queryByText(/7-day trial/)).toBeNull();
  });

  it('a paid-plan sign-up keeps "Subscribe to …", asks only email and password, sends no username', async () => {
    show('/register?tier=consultant_pro&billing=monthly');
    expect(screen.getByRole('heading', { name: /^Subscribe to/ })).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(screen.queryByLabelText(/Company/)).toBeNull();
    expect(screen.getByText('At least 8 characters.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'pay@company.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByLabelText(/I agree to the/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
    const sent = (api.register.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ email: 'pay@company.com', tier: 'consultant_pro', plan: 'monthly' });
    expect(sent).not.toHaveProperty('username');
  });
});
