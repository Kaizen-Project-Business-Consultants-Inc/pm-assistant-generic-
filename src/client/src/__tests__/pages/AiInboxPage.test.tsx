import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const base = { projectId: 'p1', projectName: 'Harbour St Clinic', scheduleId: 's1', agent: 'weekly_review', evidence: ['Row 14 is 4 days late.'], status: 'waiting', reason: null, resultSummary: null, undoRef: null, decidedAt: null, createdAt: '2026-10-16' };
let suggestions: any[] = [];
const accept = vi.fn(async (id: string, edits: any) => ({ suggestion: { id, edits } }));
const reject = vi.fn(async () => ({ suggestion: {} }));
const undo = vi.fn(async () => ({ suggestion: {} }));
vi.mock('../../services/api', () => ({
  apiService: {
    getAiInbox: vi.fn(async () => ({ suggestions })),
    acceptAiSuggestion: (id: string, edits: any) => accept(id, edits),
    rejectAiSuggestion: (...a: any[]) => reject(...(a as [])),
    undoAiSuggestion: (...a: any[]) => undo(...(a as [])),
  },
}));

import { AiInboxPage } from '../../pages/AiInboxPage';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><AiInboxPage /></MemoryRouter></QueryClientProvider>);
}

describe('AI inbox page (Phase 2)', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); suggestions = []; });

  it('nothing waiting: says when fixes arrive', async () => {
    show();
    expect(await screen.findByText('Nothing waiting')).toBeTruthy();
    expect(screen.getByText(/Every Friday morning/)).toBeTruthy();
  });

  it('a reschedule shows the old and new dates and the evidence; Accept applies it', async () => {
    suggestions = [{ ...base, id: 'a', kind: 'reschedule', title: 'Move 1 late task so the plan matches reality', detail: 'Finish moves 24 Nov → 28 Nov',
      payload: { changes: [{ taskId: 't14', name: 'Electrical first fix', startBefore: '2026-10-20', startAfter: '2026-10-20', endBefore: '2026-10-24', endAfter: '2026-10-30' }] } }];
    show();
    expect(await screen.findByText('Electrical first fix')).toBeTruthy();
    expect(screen.getByText('Oct 24')).toBeTruthy(); // the old end, struck through
    expect(screen.getByText('Oct 30')).toBeTruthy();
    expect(screen.getByText('Row 14 is 4 days late.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('a', {}));
  });

  it('a reminder can be edited before Send, and the edited text is what is sent', async () => {
    suggestions = [{ ...base, id: 'b', kind: 'remind_raid', scheduleId: null, title: 'Remind Priya Nair', detail: null,
      payload: { to: [{ name: 'Priya Nair', email: 'priya@x.ca' }], subject: 'Switchgear', body: 'Hi Priya' } }];
    show();
    expect(await screen.findByText(/Priya Nair \(priya@x\.ca\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit first' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hi Priya, by Wednesday please.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('b', { subject: 'Switchgear', body: 'Hi Priya, by Wednesday please.' }));
  });

  it('Reject asks why first', async () => {
    suggestions = [{ ...base, id: 'c', kind: 'add_links', title: 'Link 2 tasks', detail: null, payload: { links: [{ task: 'A', after: 'B' }] } }];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not a problem' }));
    await waitFor(() => expect(reject).toHaveBeenCalled());
  });

  it('a decided suggestion shows what happened and Undo when it has one', async () => {
    suggestions = [{ ...base, id: 'd', kind: 'reassign', status: 'accepted', resultSummary: 'Moved "Snag list" to Sam Reid.', undoRef: { type: 'history' }, title: 'Give it to Sam', detail: null, payload: {} }];
    show();
    expect(await screen.findByText('Moved "Snag list" to Sam Reid.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undo).toHaveBeenCalled());
  });
});
