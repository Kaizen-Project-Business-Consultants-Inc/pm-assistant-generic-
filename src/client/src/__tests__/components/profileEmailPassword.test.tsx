/**
 * Audit 2026-10-09 H2: a new email needs the current password. Settings → Profile asks for it
 * (a labelled field that appears only when the email is changed) and sends it with the save.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ updateProfile: vi.fn(async (d: any) => ({ fullName: d.fullName, email: d.email })) }));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { ProfileTab } from '../../pages/settings/ProfileTab';

const signIn = () => useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'pat@example.com', fullName: 'Pat', role: 'team_member' } as never });

describe('Settings → Profile: changing the email', () => {
  afterEach(() => { cleanup(); api.updateProfile.mockClear(); });

  it('no password field while the email is unchanged; the name saves without one', async () => {
    signIn();
    render(<ProfileTab />);
    expect(screen.queryByLabelText(/Current Password \*/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: 'Pat Q' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ fullName: 'Pat Q', email: 'pat@example.com', currentPassword: undefined }));
  });

  it('a new email asks for the current password and sends it', async () => {
    signIn();
    render(<ProfileTab />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    const pw = screen.getByLabelText(/Current Password \*/);
    expect(pw.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your current password to change your email.');
    expect(api.updateProfile).not.toHaveBeenCalled();

    fireEvent.change(pw, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ fullName: 'Pat', email: 'new@example.com', currentPassword: 'secret' }));
  });
});
