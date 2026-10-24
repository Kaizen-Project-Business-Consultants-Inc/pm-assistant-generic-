import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Staging, 2026-10-24 (the user's DBJ-LMS plan): a Critical level made only of links between tasks that
 * run at the same time — they are left out of "Select all in Critical", so the level has no such tick.
 * The user reported one Critical fix that could not be selected: every way to tick them must work.
 */
const api = vi.hoisted(() => ({
  proposeScheduleFixes: vi.fn(), applyScheduleFixes: vi.fn(), undoScheduleFixProposal: vi.fn(),
  previewScheduleFixes: vi.fn(async () => ({ tasksMoved: 0, maxShiftDays: 0, brokenLinks: 0, brokenExample: null, moves: [], finishBefore: null, finishAfter: null, finishShiftDays: 0, projectEnd: null, scoreBefore: 20, scoreAfter: 30 })),
  rejectScheduleFixProposal: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../utils/scheduleChanged', () => ({ refreshAfterScheduleChange: vi.fn() }));

import { ScheduleFixProposalPanel } from '../../components/schedule/review/ScheduleFixProposalPanel';

const overlapLink = (i: number) => ({
  id: `add_dependency:t${i}:u${i}`, type: 'add_dependency', confidence: 0.7, reason: 'they overlap', defaultChecked: false, severity: 'critical', problemKey: 'R01:x', overlaps: true,
  taskId: `t${i}`, taskName: `Task ${i}`, dependsOnTaskId: `u${i}`, dependsOnTaskName: `Before ${i}`,
});
const high = { id: 'set_duration:h1', type: 'set_duration', confidence: 0.9, reason: 'dates', defaultChecked: false, severity: 'high', taskId: 'h1', taskName: 'Review', newDuration: 3 };
const PROPOSAL = { id: 'p1', source: 'rules', proposalData: { fixes: [overlapLink(1), overlapLink(2), overlapLink(3), high], problems: { 'R01:x': { ruleId: 'R01', rule: 'Tasks with no predecessor', message: '3 tasks have no predecessor' } } } };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ScheduleFixProposalPanel scheduleId="s1" projectId="p1" onClose={vi.fn()} /></QueryClientProvider>);
}
beforeEach(() => { api.proposeScheduleFixes.mockResolvedValue(PROPOSAL); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('a Critical level made only of overlapping links', () => {
  it('each link can be ticked on its own, and the group tick ticks all three', async () => {
    renderPanel();
    const critical = await screen.findByRole('region', { name: 'Critical fixes' });
    // no "Select all in Critical" (it never takes overlapping links), but a tick of its own for the three
    expect(within(critical).queryByLabelText('Select all in Critical')).toBeNull();
    const group = within(critical).getByLabelText('Link these 3 too');
    expect(group).toBeEnabled();

    const rows = within(critical).getAllByRole('checkbox', { name: /^Select: Link/ });
    expect(rows).toHaveLength(3);
    rows.forEach(r => expect(r).toBeEnabled());
    fireEvent.click(rows[0]);
    expect(rows[0]).toBeChecked();
    expect(screen.getByRole('button', { name: /^Apply 1 fix/ })).toBeEnabled();
    fireEvent.click(group);
    within(critical).getAllByRole('checkbox', { name: /^Select: Link/ }).forEach(r => expect(r).toBeChecked());
    expect(screen.getByRole('button', { name: /^Apply 3 fixes/ })).toBeEnabled();
  });

  it('the top "Select all" leaves them out and says so (a High fix is ticked, a Critical overlap link is not)', async () => {
    renderPanel();
    await screen.findByRole('region', { name: 'Critical fixes' });
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByLabelText("Select: Set 'Review' duration to 3 days")).toBeChecked();
    screen.getAllByRole('checkbox', { name: /^Select: Link/ }).forEach(r => expect(r).not.toBeChecked());
  });
});
