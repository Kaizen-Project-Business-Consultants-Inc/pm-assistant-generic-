/**
 * Project status change (2026-10-05): the new status shows at once; a change that does not save
 * puts the old status back (as before) and now says so; onSaved (close the cancel dialog / open
 * the close-out prompt) runs only after a good save. Success is otherwise unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ updateProjectStatus: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { announce } from '../../utils/announce';
import { useProjectStatusChange } from '../../hooks/useProjectStatusChange';

const LABELS: Record<string, string> = { active: 'Active', completed: 'Completed', cancelled: 'Cancelled' };
let qc: QueryClient;

function setup() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['project', 'p1'], { project: { id: 'p1', name: 'Apollo', status: 'active' } });
  const onSaved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useProjectStatusChange('p1', s => LABELS[s] ?? s, onSaved), { wrapper });
  return { ...hook, onSaved };
}
const shownStatus = () => (qc.getQueryData(['project', 'p1']) as { project: { status: string } }).project.status;
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => { api.updateProjectStatus.mockReset(); vi.mocked(announce).mockClear(); });

describe('useProjectStatusChange', () => {
  it('success: shown at once, saved, onSaved runs, no message', async () => {
    let finish!: (v: unknown) => void;
    api.updateProjectStatus.mockImplementation(() => new Promise(r => { finish = r; }));
    const { result, onSaved } = setup();
    act(() => { result.current.statusMutation.mutate({ status: 'completed' }); });
    await flush();
    expect(shownStatus()).toBe('completed');
    expect(onSaved).not.toHaveBeenCalled(); // not before the server agrees
    await act(async () => { finish({}); });
    await flush();
    expect(api.updateProjectStatus).toHaveBeenCalledWith('p1', 'completed', undefined);
    expect(onSaved).toHaveBeenCalledWith('completed');
    expect(result.current.statusError).toBe(null);
  });

  it('failure: the old status comes back, the message says so, onSaved does not run', async () => {
    api.updateProjectStatus.mockRejectedValue({ response: { data: { message: 'Nope' } } });
    const { result, onSaved } = setup();
    act(() => { result.current.statusMutation.mutate({ status: 'cancelled', cancellationReason: 'Budget cut' }); });
    await flush();
    expect(shownStatus()).toBe('active');
    const msg = 'The status change to "Cancelled" was not saved: Nope. The last saved version is shown again — please try again.';
    expect(result.current.statusError).toBe(msg);
    expect(announce).toHaveBeenCalledWith(msg);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a good save after a failed one clears the message', async () => {
    api.updateProjectStatus.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
    const { result } = setup();
    act(() => { result.current.statusMutation.mutate({ status: 'completed' }); });
    await flush();
    expect(result.current.statusError).toBe('The status change to "Completed" was not saved. The last saved version is shown again — please try again.');
    act(() => { result.current.statusMutation.mutate({ status: 'completed' }); });
    await flush();
    expect(result.current.statusError).toBe(null);
  });
});
