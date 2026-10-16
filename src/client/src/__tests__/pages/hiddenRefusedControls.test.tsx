import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/**
 * Hide, don't disable (audit 2, 2026-10-10): controls the server always refuses for a role are
 * not shown — Create API key and the Webhooks tab for read-only roles, the 'admin' key right for
 * anyone but the Kovarti platform admin, Manage Workflows for people who don't manage the project.
 */
const api = vi.hoisted(() => ({
  listApiKeys: vi.fn(async () => ({ apiKeys: [] })),
  getOrgMembers: vi.fn(async () => ({ organization: { id: 'o', name: 'Acme' }, maxUsers: 5, members: [
    { id: 'u1', username: 'me', email: 'me@x', fullName: 'Me', role: 'pmo', isActive: true, lastLoginAt: null },
    { id: 'u2', username: 'sam', email: 'sam@x', fullName: 'Sam', role: 'team_member', isActive: true, lastLoginAt: null },
  ] })),
  getGuests: vi.fn(async () => ({ guests: [{ id: 'g1', username: 'g', email: 'g@x', fullName: 'Gus', isActive: true, guestExpiresAt: null, permissions: [] }] })),
  getProjects: vi.fn(async () => ({ projects: [] })),
  listInvites: vi.fn(async () => ({ invites: [] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
const projectRole = vi.hoisted(() => ({ canEdit: false }));
vi.mock('../../hooks/useProjectRole', () => ({ useProjectRole: () => ({ ...projectRole, role: null, canManageOwners: false, loaded: true }) }));
vi.mock('../../components/approvals/ChangeRequestList', () => ({ ChangeRequestList: () => null }));
vi.mock('../../pages/settings/ProfileTab', () => ({ ProfileTab: () => null }));

import { useAuthStore } from '../../stores/authStore';
import { ApiKeysTab } from '../../pages/settings/ApiKeysTab';
import { SettingsPage } from '../../pages/SettingsPage';
import { ChangeRequestsTab } from '../../pages/ProjectDetailPage/ChangeRequestsTab';
import { TeamTab } from '../../pages/settings/TeamTab';

function show(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const as = (role: string, isOwner = false) => useAuthStore.setState({ user: { id: 'u1', username: 'u', email: 'e', fullName: 'U', role, organization: { isOwner } } as never });

describe('controls a role is always refused are hidden', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('API keys: a team member sees their keys and why there is no Create button', async () => {
    as('team_member');
    show(<ApiKeysTab />);
    expect(await screen.findByText('No API keys.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Create Key/ })).toBeNull();
    expect(screen.getByText(/Your role can't create keys/)).toBeTruthy();
  });

  it("API keys: a project manager can create, with read and write but not 'admin'", async () => {
    as('project_manager');
    show(<ApiKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Create Key/ }));
    expect(screen.getByRole('button', { name: 'Can read' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Can change' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kovarti admin' })).toBeNull();
  });

  it("API keys: the Kovarti platform admin is offered 'admin'", async () => {
    as('admin');
    show(<ApiKeysTab />);
    fireEvent.click(await screen.findByRole('button', { name: /Create Key/ }));
    expect(screen.getByRole('button', { name: 'Kovarti admin' })).toBeTruthy();
  });

  it('Settings: Webhooks only for roles that may change data; Connections & API keys for everyone', () => {
    as('team_member');
    show(<SettingsPage />);
    expect(screen.queryByRole('button', { name: /Webhooks/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Connections & API keys/ })).toBeTruthy();
    cleanup();
    as('project_manager');
    show(<SettingsPage />);
    expect(screen.getByRole('button', { name: /Webhooks/ })).toBeTruthy();
  });

  it('Settings: every section is in the list down the left, grouped, the open one marked (U9)', () => {
    as('project_manager');
    show(<SettingsPage />);
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(Array.from(nav.querySelectorAll('h2')).map(h => h.textContent)).toEqual(['You', 'Company', 'Advanced']);
    for (const name of ['Profile', 'AI assistant', 'Team', 'Connections & API keys', 'Webhooks', 'Danger zone']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /Profile/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: /AI Context|API Keys/ })).toBeNull();
  });

  it("Change requests: Manage Workflows only for the project's Manager/Owner", () => {
    projectRole.canEdit = false;
    show(<ChangeRequestsTab projectId="p1" />);
    expect(screen.queryByRole('button', { name: 'Manage Workflows' })).toBeNull();
    cleanup();
    projectRole.canEdit = true;
    show(<ChangeRequestsTab projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Manage Workflows' })).toBeTruthy();
  });

  it('Team: only the company owner invites members, changes roles and removes people', async () => {
    as('pmo', true);
    show(<TeamTab />);
    expect(await screen.findByRole('combobox', { name: 'Role for Sam' })).toBeTruthy();
    expect(screen.getByLabelText('Email address to invite')).toBeTruthy();
    expect(screen.getByTitle('Remove member')).toBeTruthy();
    expect(await screen.findByTitle('Revoke access')).toBeTruthy();
    cleanup();
    as('pmo');
    show(<TeamTab />);
    expect(await screen.findByText('Sam')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Role for Sam' })).toBeNull();
    expect(screen.queryByLabelText('Email address to invite')).toBeNull();
    expect(screen.queryByTitle('Remove member')).toBeNull();
    expect(screen.getByText(/Only the company owner invites people/)).toBeTruthy();
  });

  it('Team: a project manager may invite guests but not revoke them; a PMO neither', async () => {
    as('project_manager');
    show(<TeamTab />);
    expect(await screen.findByText('Gus')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Invite Guest/ })).toBeTruthy();
    expect(screen.queryByTitle('Revoke access')).toBeNull();
    cleanup();
    as('pmo');
    show(<TeamTab />);
    expect(await screen.findByText('Gus')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Invite Guest/ })).toBeNull();
  });
});
