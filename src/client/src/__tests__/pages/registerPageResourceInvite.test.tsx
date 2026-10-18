import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * U40 (2026-10-18): a resource's invitation says who it is for. The invite page names the person
 * and their email, prefills "Your name" (still editable, never over what was already typed), and,
 * when someone else is signed in, says so and offers Sign out without leaving the page.
 */
const api = vi.hoisted(() => ({
  register: vi.fn(async () => ({ message: 'ok' })),
  validateInvite: vi.fn(async () => ({ valid: true, orgName: 'Acme', email: 'mike_todo@yahoo.com', resourceName: 'Peter Pan' })),
  getAuthProviders: vi.fn(async () => ({ google: false })),
  logout: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../components/auth/TurnstileWidget', () => ({ TurnstileWidget: () => null }));

import { useAuthStore } from '../../stores/authStore';
import { RegisterPage } from '../../pages/RegisterPage';

const show = () => render(<MemoryRouter initialEntries={['/register?invite=abc123']}><RegisterPage /></MemoryRouter>);

describe('resource invitation page says who it is for', () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: null } as never); });
  afterEach(cleanup);

  it('names the person and prefills Your name, which stays editable with autofill on', async () => {
    show();
    expect(await screen.findByText('This invitation is for Peter Pan (mike_todo@yahoo.com)')).toBeTruthy();
    const name = screen.getByLabelText('Your name') as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('Peter Pan'));
    expect(name.getAttribute('autocomplete')).toBe('name');
    expect(name.readOnly).toBe(false);
    fireEvent.change(name, { target: { value: 'Peter J. Pan' } });
    expect(name.value).toBe('Peter J. Pan');
  });

  it('never overwrites a name already typed (or autofilled) before the invitation loads', async () => {
    let resolve!: (v: unknown) => void;
    api.validateInvite.mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);
    show();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Pete' } });
    resolve({ valid: true, orgName: 'Acme', email: 'mike_todo@yahoo.com', resourceName: 'Peter Pan' });
    expect(await screen.findByText('This invitation is for Peter Pan (mike_todo@yahoo.com)')).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Pete');
  });

  it('a plain company invite (no resource) keeps the old line and an empty name', async () => {
    api.validateInvite.mockResolvedValueOnce({ valid: true, orgName: 'Acme', email: 'sam@acme.com' } as never);
    show();
    expect(await screen.findByText("You've been invited to join this organization")).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('');
  });

  it('signed in as someone else: says so, and Sign out stays on the invitation', async () => {
    useAuthStore.setState({ user: { id: 'u1', fullName: 'George Bailoo', email: 'george@x.com' } } as never);
    show();
    expect(await screen.findByText('Peter Pan (mike_todo@yahoo.com)')).toBeTruthy();
    expect(screen.getByText(/This browser is signed in as/).textContent).toBe('This browser is signed in as George Bailoo.');
    expect(screen.getByText('Sign out to accept it as Peter Pan.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('This invitation is for Peter Pan (mike_todo@yahoo.com)')).toBeTruthy();
    expect(useAuthStore.getState().user).toBeNull();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Peter Pan');
  });
});
