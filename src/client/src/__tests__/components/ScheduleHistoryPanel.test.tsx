import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getScheduleChanges: vi.fn(), undoScheduleChange: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleHistoryPanel, whoDidIt, type ScheduleChange } from '../../components/schedule/ScheduleHistoryPanel';

const now = new Date().toISOString();
const changes: ScheduleChange[] = [
  { id: 'c1', kind: 'link', summary: 'Added 33 links', actorId: 'u-me', actorName: 'Michael A', source: 'mcp', status: 'applied', undoable: true, createdAt: now, undoneAt: null, undoneByName: null },
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
    await waitFor(() => expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'c1', false));
    expect(await screen.findByText('Undone: Added 33 links')).toBeInTheDocument();
  });

  it('warns when the tasks were edited since, and only overwrites on "Undo anyway"', async () => {
    api.undoScheduleChange
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'edited_since', editedCount: 2, message: '2 of these tasks were changed after this. Undo anyway to overwrite those later changes.' } } })
      .mockResolvedValueOnce({ restored: 33 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Undo$/ }));
    expect(await screen.findByText(/2 of these tasks were changed after this/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo anyway' }));
    await waitFor(() => expect(api.undoScheduleChange).toHaveBeenLastCalledWith('s1', 'c1', true));
  });

  it('viewers can read the history but not undo', async () => {
    renderPanel(false);
    expect(await screen.findByText('Added 33 links')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo$/ })).not.toBeInTheDocument();
  });
});
