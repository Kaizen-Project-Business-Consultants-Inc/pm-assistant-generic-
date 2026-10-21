import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * UAT 2026-10-20 (approved mock https://claude.ai/artifact/K29pNmB79C4wjwEM2WELbi):
 * U53 — the review said 1 critical, the panel "Critical · 27 fixes", Apply 20, and 5 rows showed:
 *       the panel now names the problem, counts problems as the review does, and shows every ticked row.
 * U54 — Undo appeared where Apply had been and a second click removed the 20 links: Undo now sits
 *       in the result box and asks first; the footer only says Done.
 */
const api = vi.hoisted(() => ({
  proposeScheduleFixes: vi.fn(),
  applyScheduleFixes: vi.fn(),
  undoScheduleFixProposal: vi.fn(async () => ({})),
  rejectScheduleFixProposal: vi.fn(),
  previewScheduleFixes: vi.fn(async () => ({ tasksMoved: 0, finishBefore: null, finishAfter: null, finishShiftDays: 0, projectEnd: null, scoreBefore: 17, scoreAfter: 58 })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleFixProposalPanel } from '../../components/schedule/review/ScheduleFixProposalPanel';

const R03 = { ruleId: 'R03', rule: 'No logic at all', message: 'None of the 28 tasks are linked.' };
const link = (i: number, overlaps = false) => ({
  id: `d${i}`, type: 'add_dependency', confidence: 0.9, reason: 'seq', defaultChecked: true, severity: 'critical', problemKey: 'R03:', overlaps,
  taskId: `b${i}`, taskName: `Build ${i}`, dependsOnTaskId: `a${i}`, dependsOnTaskName: `Design ${i}`,
});
// 8 links that follow the dates + 2 overlapping: more than the 5 rows a list shows at first
const PROPOSAL = {
  id: 'prop-1', source: 'rules',
  proposalData: { fixes: [...[1, 2, 3, 4, 5, 6, 7, 8].map(i => link(i)), link(9, true), link(10, true)], problems: { 'R03:': R03 } },
};

function renderPanel(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><ScheduleFixProposalPanel scheduleId="s1" projectId="p1" onClose={onClose} /></QueryClientProvider>);
  return onClose;
}

beforeEach(() => { api.proposeScheduleFixes.mockResolvedValue(PROPOSAL); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Propose fixes counts problems as the review does (U53)', () => {
  it('the level names its one problem and how many fixes are offered', async () => {
    renderPanel();
    const critical = await screen.findByRole('region', { name: 'Critical fixes' });
    expect(within(critical).getByText('1 problem')).toBeInTheDocument();
    expect(within(critical).getByText(/10 links to add/)).toBeInTheDocument(); // U60: a level of links says so
    expect(within(critical).getByText('No logic at all')).toBeInTheDocument();
  });

  it('a rule with one finding per task counts each, as the review does (two milestones that span days = 2 problems)', async () => {
    const split = (id: string, task: string) => ({ id, type: 'split_task', confidence: 0.8, reason: 'gate', defaultChecked: false, severity: 'high', problemKey: `R04:${task}`, taskId: task, taskName: task, replace: true, parts: [] });
    api.proposeScheduleFixes.mockResolvedValueOnce({
      id: 'prop-2', source: 'rules',
      proposalData: {
        fixes: [split('s1', 'm1'), split('s2', 'm2')],
        problems: {
          'R04:m1': { ruleId: 'R04', rule: 'Milestone with a duration', message: "'Design sign-off' spans 5 working days" },
          'R04:m2': { ruleId: 'R04', rule: 'Milestone with a duration', message: "'Build sign-off' spans 3 working days" },
        },
      },
    });
    renderPanel();
    const high = await screen.findByRole('region', { name: 'High fixes' });
    expect(within(high).getByText('2 problems')).toBeInTheDocument();
    expect(within(high).getByText(/Design sign-off/)).toBeInTheDocument();
    expect(within(high).getByText(/Build sign-off/)).toBeInTheDocument();
    fireEvent.click(within(high).getByLabelText('Select all in High'));
    expect(screen.getByRole('button', { name: 'Apply 2 fixes — fixes 2 high problems' })).toBeEnabled();
  });

  it('Select all ticks the 8 that follow the dates — all 8 visible — and Apply says it fixes 1 critical problem', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Select all in Critical'));
    for (let i = 1; i <= 8; i++) expect(screen.getByLabelText(new RegExp(`Select: Link 'Build ${i}'`))).toBeChecked();
    expect(screen.queryByRole('button', { name: /Show \d+ more/ })).toBeNull(); // nothing ticked is hidden
    expect(screen.getByText(/8 ticked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 8 fixes — fixes 1 critical problem' })).toBeEnabled();
  });
});

describe('Undo is never where Apply was (U54)', () => {
  beforeEach(() => {
    api.applyScheduleFixes.mockResolvedValue({ beforeScore: 17, afterScore: 58, appliedCount: 8, datesMoved: 0, dateDeltas: [], skipped: [] });
  });

  it('after Apply the footer only says Done; Undo sits in the result and asks first', async () => {
    const onClose = renderPanel();
    fireEvent.click(await screen.findByLabelText('Select all in Critical'));
    const apply = screen.getByRole('button', { name: /^Apply 8 fixes/ });
    fireEvent.click(apply);
    expect(await screen.findByText('17 → 58')).toBeInTheDocument();

    // the second click lands on Done, which only closes the panel
    expect(screen.queryByRole('button', { name: /^Undo$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.undoScheduleFixProposal).not.toHaveBeenCalled();

    // Undo asks, with focus on the safe answer; "Keep them" keeps them and focus goes back to Undo
    fireEvent.click(screen.getByRole('button', { name: 'Undo these 8 fixes' }));
    expect(screen.getByText('Remove the 8 fixes you just applied?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep them' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(api.undoScheduleFixProposal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo these 8 fixes' })).toHaveFocus();

    // "Yes, undo" undoes, and says so
    fireEvent.click(screen.getByRole('button', { name: 'Undo these 8 fixes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, undo' }));
    await waitFor(() => expect(api.undoScheduleFixProposal).toHaveBeenCalledWith('s1', 'prop-1'));
    expect(await screen.findByText('Undone — the 8 fixes you applied were removed.')).toBeInTheDocument();
    expect(screen.getByText(/as it was before Apply \(score 17\)/)).toBeInTheDocument();
  });

  it('while applying, it says so and the list cannot be clicked', async () => {
    let finish!: (v: unknown) => void;
    api.applyScheduleFixes.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Select all in Critical'));
    fireEvent.click(screen.getByRole('button', { name: /^Apply 8 fixes/ }));
    expect(await screen.findByText(/Applying 8 fixes… this takes a few seconds/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Critical fixes' }).closest('fieldset')).toHaveAttribute('aria-busy', 'true');
    // the keyboard can't change ticks either: every box is disabled while it saves
    expect(screen.getByLabelText(/Select: Link 'Build 1'/)).toBeDisabled();
    finish({ beforeScore: 17, afterScore: 58, appliedCount: 8, datesMoved: 0, dateDeltas: [], skipped: [] });
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
