import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** The one place that turns a typed client name into a client id (UAT U35, 2026-10-18). */
const api = vi.hoisted(() => ({
  getProjectGroups: vi.fn(async () => ({ groups: [{ id: 'g1', name: 'Acme Bank' }] })),
  createProjectGroup: vi.fn(async (d: { name: string }) => ({ id: `new-${d.name}`, name: d.name })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { useClientChoice } from '../../hooks/useClientChoice';

const setUser = (u: Record<string, unknown>) => useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'p@x.test', role: 'project_manager', ...u } } as never);
const mount = async (enabled = true) => {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const r = renderHook(() => useClientChoice(enabled), { wrapper });
  if (enabled) await waitFor(() => expect(r.result.current.loading).toBe(false));
  return r;
};

describe('useClientChoice', () => {
  beforeEach(() => { vi.clearAllMocks(); setUser({}); });

  it('blank text is no client', async () => {
    const { result } = await mount();
    expect(await result.current.resolveClientId('   ')).toBeNull();
    expect(api.createProjectGroup).not.toHaveBeenCalled();
  });

  it('a name matching a client (any case, spaces) is that client — nothing is added', async () => {
    const { result } = await mount();
    expect(await result.current.resolveClientId('  acme bank ')).toBe('g1');
    expect(api.createProjectGroup).not.toHaveBeenCalled();
  });

  it('a new name adds the client once; a retry with the same name reuses it', async () => {
    const { result } = await mount();
    expect(await result.current.resolveClientId('Globex')).toBe('new-Globex');
    expect(await result.current.resolveClientId('globex')).toBe('new-Globex');
    expect(api.createProjectGroup).toHaveBeenCalledTimes(1);
    expect(api.createProjectGroup).toHaveBeenCalledWith({ name: 'Globex' });
  });

  it('a refused name (e.g. already exists) is passed on to the screen to show', async () => {
    api.createProjectGroup.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409 } }));
    const { result } = await mount();
    await expect(result.current.resolveClientId('Initech')).rejects.toThrow();
    // and the next try asks again rather than reusing a client that was never made
    expect(await result.current.resolveClientId('Initech')).toBe('new-Initech');
  });

  it.each([['sme', 'Client or department'], ['enterprise', 'Client or department'], ['consultant_pro', 'Client'], ['trial', 'Client']])('label for %s is "%s"', async (tier, label) => {
    setUser({ subscriptionTier: tier });
    const { result } = await mount();
    expect(result.current.label).toBe(label);
  });

  it.each([['pmo', true], ['project_manager', true], ['team_member', false], ['viewer', false]])('%s may add clients: %s', async (role, can) => {
    setUser({ role });
    const { result } = await mount();
    expect(result.current.canManage).toBe(can);
  });

  it('does not load the list when not enabled', async () => {
    const { result } = await mount(false);
    expect(result.current.loading).toBe(false);
    expect(api.getProjectGroups).not.toHaveBeenCalled();
  });
});
