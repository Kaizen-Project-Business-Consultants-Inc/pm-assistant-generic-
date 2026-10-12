/**
 * Manage clients (audit 2, L-g, 2026-10-11): rename, delete and the move handle show only for the company owner/PMO
 * or the project manager who added that client — "hide, don't disable". Others see the name only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: {
    getProjectGroups: vi.fn().mockResolvedValue({ groups: [
      { id: 'g1', name: 'Acme', color: '#6366f1', icon: null, sortOrder: 0, createdBy: 'pm-alice' },
      { id: 'g2', name: 'Globex', color: '#3b82f6', icon: null, sortOrder: 1, createdBy: 'pm-bob' },
    ] }),
  },
}));

import { ProjectGroupManager } from '../../components/projects/ProjectGroupManager';
import { canChangeClient } from '../../hooks/useCanManageClients';
import { useAuthStore, type User } from '../../stores/authStore';

afterEach(() => { cleanup(); useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false }); });

function signIn(id: string, role: string) {
  useAuthStore.setState({ user: { id, username: id, email: `${id}@x`, fullName: id, role, emailVerified: true } as User, isAuthenticated: true, isLoading: false });
}
function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProjectGroupManager isOpen onClose={() => {}} /></QueryClientProvider>);
}

describe('Manage clients — who can rename or delete', () => {
  it('a project manager sees rename/delete only on the client they added', async () => {
    signIn('pm-alice', 'project_manager');
    renderManager();
    expect(await screen.findByRole('button', { name: 'Rename client Acme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete client Acme' })).toBeTruthy();
    expect(screen.getByText('Globex')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rename client Globex' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete client Globex' })).toBeNull();
    // the move (reorder) handle too: only on the client they added
    expect(screen.getAllByTestId('client-move-handle')).toHaveLength(1);
  });

  it('the PMO (and so the owner) sees rename/delete on every client', async () => {
    signIn('boss', 'pmo');
    renderManager();
    expect(await screen.findByRole('button', { name: 'Delete client Acme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete client Globex' })).toBeTruthy();
    expect(screen.getAllByTestId('client-move-handle')).toHaveLength(2);
  });

  it('canChangeClient: same rule as the server', () => {
    const pm = { id: 'pm-alice', role: 'project_manager' } as User;
    expect(canChangeClient(pm, { createdBy: 'pm-alice' })).toBe(true);
    expect(canChangeClient(pm, { createdBy: 'pm-bob' })).toBe(false);
    expect(canChangeClient(pm, { createdBy: null })).toBe(false);
    expect(canChangeClient({ id: 'x', role: 'pmo' } as User, { createdBy: 'pm-bob' })).toBe(true);
    expect(canChangeClient({ id: 'pm-bob', role: 'team_member' } as User, { createdBy: 'pm-bob' })).toBe(false);
    expect(canChangeClient(null, { createdBy: 'pm-bob' })).toBe(false);
  });
});
