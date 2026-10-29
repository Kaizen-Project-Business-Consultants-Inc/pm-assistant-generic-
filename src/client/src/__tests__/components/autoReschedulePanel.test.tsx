// @vitest-environment happy-dom
/**
 * AI Reschedule panel (2026-10-24): click a late task to light it up in the schedule, close a task
 * that was finished but never marked complete, and accept only the changes that are ticked.
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const DELAYS = [
  { taskId: 'a', taskName: 'Build APIs', delayDays: 3, severity: 'medium', isOnCriticalPath: false, currentProgress: 40, expectedEndDate: '2026-10-20', status: 'in_progress' },
  { taskId: 'b', taskName: 'Data migration', delayDays: 5, severity: 'high', isOnCriticalPath: true, currentProgress: 0, expectedEndDate: '2026-10-22', status: 'pending' },
];
const PROPOSAL = {
  id: 'prop-1',
  rationale: 'Shift the follow-on work.',
  estimatedImpact: { originalEndDate: '2026-11-01', proposedEndDate: '2026-11-08', daysChange: 5 },
  proposedChanges: [
    { taskId: 'b', taskName: 'Data migration', currentStartDate: '2026-10-28', currentEndDate: '2026-11-02', proposedStartDate: '2026-11-03', proposedEndDate: '2026-11-08', reason: 'After APIs' },
    { taskId: 'c', taskName: 'UAT sign-off', currentStartDate: '2026-11-03', currentEndDate: '2026-11-06', proposedStartDate: '2026-11-09', proposedEndDate: '2026-11-12', reason: 'After migration' },
  ],
};

const api = vi.hoisted(() => ({
  getDelays: vi.fn(),
  generateRescheduleProposal: vi.fn(),
  acceptRescheduleProposal: vi.fn(),
  updateTask: vi.fn(),
  rejectRescheduleProposal: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { AutoReschedulePanel } from '../../components/schedule/AutoReschedulePanel';

function setup(delays: unknown[] = DELAYS) {
  api.getDelays.mockResolvedValue({ delayedTasks: delays });
  api.generateRescheduleProposal.mockResolvedValue({ proposal: PROPOSAL });
  api.acceptRescheduleProposal.mockResolvedValue({});
  api.updateTask.mockResolvedValue({});
  api.rejectRescheduleProposal.mockResolvedValue({});
  const onHighlightTasks = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AutoReschedulePanel
        scheduleId="s1"
        projectId="p1"
        onClose={() => {}}
        onHighlightTasks={onHighlightTasks}
        // UAT waits for Data migration
        predecessorsOf={(id) => (id === 'c' ? ['b'] : [])}
      />
    </QueryClientProvider>,
  );
  return { onHighlightTasks };
}

// Generate Proposal stays off until the late list has loaded
async function generate() {
  await screen.findByText('Build APIs');
  fireEvent.click(screen.getByRole('button', { name: /Generate Proposal/i }));
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AI Reschedule panel', () => {
  it('clicking a late task highlights it in the schedule', async () => {
    const { onHighlightTasks } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Data migration/ }));
    expect(onHighlightTasks).toHaveBeenCalledWith(['b']);
  });

  it('shows the task status so a forgotten "complete" can be spotted', async () => {
    setup();
    expect(await screen.findByText(/Not Started · 0% done/)).toBeTruthy();
    expect(screen.getByText(/On Track · 40% done/)).toBeTruthy();
  });

  it('Mark complete closes the task with the chosen finish date and refreshes the late list', async () => {
    setup();
    const buttons = await screen.findAllByRole('button', { name: 'Mark complete' });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
    const [scheduleId, taskId, body] = api.updateTask.mock.calls[0];
    expect([scheduleId, taskId]).toEqual(['s1', 'a']);
    expect(body).toMatchObject({ status: 'completed', progressPercentage: 100 });
    expect(body.actualEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(api.getDelays.mock.calls.length).toBeGreaterThan(1));
  });

  it('Mark complete after a proposal is on screen rejects and clears it, with a note', async () => {
    setup();
    await generate();
    await screen.findByRole('button', { name: 'Accept 2 of 2 changes' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark complete' })[0]);
    await waitFor(() => expect(api.rejectRescheduleProposal).toHaveBeenCalledWith('prop-1', expect.any(String)));
    expect(await screen.findByText(/proposal was cleared/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
  });

  it('a phase (summary row) cannot be marked complete, and the finish date cannot be in the future', async () => {
    const { onHighlightTasks } = setup([{ ...DELAYS[0], isSummary: true }, DELAYS[1]]);
    await screen.findByText('Build APIs');
    expect(onHighlightTasks).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Mark complete' })).toHaveLength(1);
    const d = document.querySelector('input[type="date"]') as HTMLInputElement;
    const local = new Date(); const ymd = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(d.max).toBe(ymd);
  });

  it('accepts only the ticked changes, and warns when a ticked change waits for an un-ticked one', async () => {
    setup();
    await generate();
    const accept = await screen.findByRole('button', { name: 'Accept 2 of 2 changes' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include change to Data migration' }));
    expect(screen.getByText(/UAT sign-off waits for this task/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept 1 of 2 changes' })).toBe(accept);

    fireEvent.click(accept);
    await waitFor(() => expect(api.acceptRescheduleProposal).toHaveBeenCalledWith('prop-1', ['c']));
  });

  it('sends no list when everything is ticked, and cannot accept with nothing ticked', async () => {
    setup();
    await generate();
    fireEvent.click(await screen.findByRole('button', { name: 'Accept 2 of 2 changes' }));
    await waitFor(() => expect(api.acceptRescheduleProposal).toHaveBeenCalledWith('prop-1', undefined));
  });

  it('Accept is off when no change is ticked', async () => {
    setup();
    await generate();
    await screen.findByRole('button', { name: 'Accept 2 of 2 changes' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include change to Data migration' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include change to UAT sign-off' }));
    const none = screen.getByRole('button', { name: 'Nothing ticked' }) as HTMLButtonElement;
    expect(none.disabled).toBe(true);
  });
});
