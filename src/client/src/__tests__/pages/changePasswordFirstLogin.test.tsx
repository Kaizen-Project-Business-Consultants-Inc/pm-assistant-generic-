import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * An invited person's first sign-in (U42, approved mock 2026-10-19): after choosing their password,
 * "Is this your name?", then their one project (GET /projects answers { data, … }) or the dashboard.
 * A guest skips the name check.
 */
const api = vi.hoisted(() => ({
  changePassword: vi.fn(async () => ({})),
  getProjects: vi.fn(),
  updateProfile: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { ChangePasswordPage } from '../../pages/ChangePasswordPage';

const invited = {
  id: 'u2', username: 'priya', email: 'priya@acme.test', fullName: 'priya', role: 'team_member', mustChangePassword: true,
  organization: { id: 'o1', name: 'Acme', slug: 'acme', isOwner: false },
};

function setPassword() {
  render(
    <MemoryRouter initialEntries={['/change-password']}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/dashboard" element={<p>Dashboard</p>} />
        <Route path="/project/:id" element={<p>Project page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Temporary Password'), { target: { value: 'temp1234' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPassword1' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPassword1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));
}

describe('invited person: password, then name, then their project', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  it('on exactly one project (the sample left out): goes straight to it', async () => {
    useAuthStore.setState({ user: invited } as never);
    api.getProjects.mockResolvedValue({ data: [{ id: 'p9' }, { id: 'sample', isDemo: true }], total: 2 });
    setPassword();
    fireEvent.click(await screen.findByRole('button', { name: "Yes, that's me" }));
    expect(await screen.findByText('Project page')).toBeTruthy();
  });

  it('on several projects (or none): the dashboard', async () => {
    useAuthStore.setState({ user: invited } as never);
    api.getProjects.mockResolvedValue({ data: [{ id: 'p1' }, { id: 'p2' }], total: 2 });
    setPassword();
    fireEvent.click(await screen.findByRole('button', { name: "Yes, that's me" }));
    expect(await screen.findByText('Dashboard')).toBeTruthy();
  });

  it('a guest has no name check', async () => {
    useAuthStore.setState({ user: { ...invited, isGuest: true } } as never);
    setPassword();
    expect(await screen.findByText('Dashboard')).toBeTruthy();
    expect(screen.queryByText(/Is this your name/)).toBeNull();
  });
});
