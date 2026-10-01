import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getScheduleChanges: vi.fn(), undoScheduleChange: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleHistoryPanel, whoDidIt, type ScheduleChange } from '../../components/schedule/ScheduleHistoryPanel';

const now = new Date().toISOString();
const changes: ScheduleChange[] = [
  { id: 'c1', kind: 'link', summary: 'Added 33 links', actorId: 'u-me', actorName: 'Michael A', source: 'mcp', status: 'applied', undoable: true, createdAt: now, undoneAt: null, undoneByName: null, details: ['Linked Design Review → Build Sprint 1', 'Build Sprint 1: start 12 Oct → 19 Oct'] },
  { id: 'c3', kind: 'bulk_update', summary: 'Edited 2 tasks', actorId: 'u-me', actorName: 'Michael A', source: 'web', status: 'applied', undoable: false, createdAt: now, undoneAt: null, undoneByName: null, details: ['UAT: finish 2 Nov → 9 Nov'] },
  { id: 'c2', kind: 'bulk_status', summary: 'Set 6 tasks to Done', actorId: 'u-2', actorName: 'Dana P', source: 'web', status: 'undone', undoable: false, createdAt: now, undoneAt: now, undoneByName: 'Michael A' },
];

function renderPanel(canEdit = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleHistoryPanel scheduleId="s1" canEdit={canEdit} currentUserId="u-me" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { api.getScheduleChanges.mockResolvedValue(changes); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('whoDidIt', () => {
  it('says You, a colleague’s name, or Claude on someone’s behalf', () => {
    expect(whoDidIt({ actorId: 'u-me', actorName: 'Michael A', source: 'web' }, 'u-me')).toBe('You');
    expect(whoDidIt({ actorId: 'u-2', actorName: 'Dana P', source: 'web' }, 'u-me')).toBe('Dana P');
    expect(whoDidIt({ actorId: 'u-me', actorName: 'Michael A', source: 'mcp' }, 'u-me')).toBe('Claude (for you)');
    expect(whoDidIt({ actorId: 'u-2', actorName: 'Dana P', source: 'mcp' }, 'u-me')).toBe('Claude (for Dana P)');
    expect(whoDidIt({ actorId: null, actorName: null, source: 'system' }, 'u-me')).toBe('System');
  });
});

describe('ScheduleHistoryPanel', () => {
  it('lists changes, who made them, and what was already undone', async () => {
    renderPanel();
    expect(await screen.findByText('Added 33 links')).toBeInTheDocument();
    expect(screen.getByText('Claude (for you)')).toBeInTheDocument();
    expect(screen.getByText(/Undone .*by Michael A/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Undo$/ })).toHaveLength(1); // only the one still applied
  });

  it('undoes a change and says so', async () => {
    api.undoScheduleChange.mockResolvedValueOnce({ restored: 33 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Undo$/ }));
    await waitFor(() => expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'c1'));
    expect(await screen.findByText('Undone: Added 33 links')).toBeInTheDocument();
  });

  it('shows what each change did, and Undo only on the newest one — no "Undo anyway"', async () => {
    renderPanel();
    expect(await screen.findByText('Build Sprint 1: start 12 Oct → 19 Oct')).toBeInTheDocument();
    expect(screen.getByText('UAT: finish 2 Nov → 9 Nov')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Undo$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Undo anyway' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the most recent change can be undone/)).toBeInTheDocument();
  });

  it('if the plan changed meanwhile, says why and changes nothing', async () => {
    api.undoScheduleChange.mockRejectedValueOnce({ response: { status: 409, data: { error: 'not_latest', message: 'Only the most recent change can be undone, and only until something else in the plan changes.' } } });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Undo$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/only until something else in the plan changes/);
    expect(api.undoScheduleChange).toHaveBeenCalledTimes(1);
  });

  it('viewers can read the history but not undo', async () => {
    renderPanel(false);
    expect(await screen.findByText('Added 33 links')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo$/ })).not.toBeInTheDocument();
  });
});
