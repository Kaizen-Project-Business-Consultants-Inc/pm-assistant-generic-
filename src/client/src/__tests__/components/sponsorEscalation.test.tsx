import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getProjectSponsor: vi.fn(),
  escalateRaidItem: vi.fn(),
  dismissEscalationPrompt: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { SponsorEscalation } from '../../components/risks/SponsorEscalation';

const critical = { id: 'r-4', type: 'issue', severity: 'critical', status: 'open', escalatedAt: null, escalationPromptDismissedAt: null };
function show(item: any, canEdit: boolean, onChanged = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SponsorEscalation projectId="p-1" item={item} canEdit={canEdit} onChanged={onChanged} /></QueryClientProvider>);
  return onChanged;
}

/** Sponsor escalation (Oct 2026): nothing goes by itself; the PM is prompted at Critical and decides */
describe('escalating a RAID item to the sponsor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProjectSponsor.mockResolvedValue({ sponsor: { kind: 'user', id: 'exec-1', name: 'Dana Whitfield' } });
    api.escalateRaidItem.mockResolvedValue({});
    api.dismissEscalationPrompt.mockResolvedValue({});
  });
  afterEach(cleanup);

  it('the PM sees the Critical prompt; sending needs a note and goes only when they press Send', async () => {
    const onChanged = show(critical, true);
    expect(screen.getByText(/This is now Critical/)).toBeTruthy();
    expect(api.escalateRaidItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Escalate to sponsor/ }));
    expect(await screen.findByText('Escalate to Dana Whitfield (sponsor)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send to sponsor/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Write a short note/);
    expect(api.escalateRaidItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Escalate to Dana Whitfield (sponsor)'), { target: { value: 'Decision by Fri' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to sponsor/ }));
    await waitFor(() => expect(api.escalateRaidItem).toHaveBeenCalledWith('p-1', 'r-4', 'Decision by Fri'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('"Not now" hides the prompt', async () => {
    show(critical, true);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(api.dismissEscalationPrompt).toHaveBeenCalledWith('p-1', 'r-4'));
  });

  it('with no sponsor set, it says where to set one', async () => {
    api.getProjectSponsor.mockResolvedValue({ sponsor: null });
    show(critical, true);
    fireEvent.click(screen.getByRole('button', { name: /Escalate to sponsor/ }));
    expect(await screen.findByText(/no sponsor yet/)).toBeTruthy();
  });

  it('a team member or viewer sees no prompt and no button — only the tag once escalated', () => {
    show(critical, false);
    expect(screen.queryByText(/This is now Critical/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    show({ ...critical, escalatedAt: '2026-10-03 14:05:00' }, false);
    expect(screen.getByText(/Escalated to sponsor/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
