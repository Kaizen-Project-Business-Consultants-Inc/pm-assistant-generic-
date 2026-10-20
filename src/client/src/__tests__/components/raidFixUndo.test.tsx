import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** U54 sweep (2026-10-20): RAID Review fixes had the same trap — Undo appeared where Apply was. */
const api = vi.hoisted(() => ({
  getRaidReviewFixes: vi.fn(async () => ({
    fixes: [{ id: 'f1', kind: 'change_type', itemId: 'i1', recordId: null, itemTitle: 'Vendor late', text: 'Make "Vendor late" an issue', reason: 'it happened', confidence: 0.9, defaultChecked: true, toType: 'issue' }],
    people: [],
  })),
  applyRaidReviewFixes: vi.fn(async () => ({ batchId: 'b1', applied: 1, summary: '1 item changed' })),
  undoRaidReviewFixes: vi.fn(async () => ({ restored: 1 })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { RaidFixPanel } from '../../components/raids/review/RaidFixPanel';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('RAID Review fixes: Undo is never where Apply was (U54)', () => {
  it('after Apply the footer says Done; Undo is in the result and asks first', async () => {
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><RaidFixPanel projectId="p1" onClose={onClose} /></QueryClientProvider>);
    // ticked at the start (defaultChecked)
    expect(await screen.findByLabelText('Select: Make "Vendor late" an issue')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Apply selected \(1\)/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.undoRaidReviewFixes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Undo this fix' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo' }));
    await waitFor(() => expect(api.undoRaidReviewFixes).toHaveBeenCalledWith('p1', 'b1'));
    expect(await screen.findByText(/back to how it was before Apply/)).toBeInTheDocument();
  });
});
