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

    // Undo asks, with focus on the safe answer; "Keep them" keeps them and focus goes back to the button that opened it
    fireEvent.click(screen.getByRole('button', { name: 'Undo all (8)' }));
    expect(screen.getByText('Put back all 8 fixes?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep them' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(api.undoScheduleFixProposal).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Undo all (8)' })).toHaveFocus();

    // "Yes, put back" undoes the whole Apply (no list of fixes sent), and says so
    fireEvent.click(screen.getByRole('button', { name: 'Undo all (8)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 8' }));
    await waitFor(() => expect(api.undoScheduleFixProposal).toHaveBeenCalledWith('s1', 'prop-1', undefined));
    expect(await screen.findByText('Undone — the 8 fixes you applied were removed.')).toBeInTheDocument();
    expect(screen.getByText(/as it was before Apply \(score 17\)/)).toBeInTheDocument();
  });

  describe('Undo selected (U80, mock approved 2026-10-24)', () => {
    async function applyAll(onClose = vi.fn()) {
      renderPanel(onClose);
      fireEvent.click(await screen.findByLabelText('Select all in Critical'));
      fireEvent.click(screen.getByRole('button', { name: /^Apply 8 fixes/ }));
      expect(await screen.findByText('17 → 58')).toBeInTheDocument();
      return onClose;
    }

    it('nothing is ticked at first, so Undo selected waits; ticking some puts back only those and says what is left', async () => {
      await applyAll();
      const undoSelected = () => screen.getByRole('button', { name: /^Undo selected/ });
      expect(undoSelected()).toBeDisabled();
      expect(screen.getByText('0 selected')).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 2'/));
      expect(undoSelected()).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Undo selected (2)' })).toBeInTheDocument();
      fireEvent.click(undoSelected());
      // the question lists exactly what goes back, and says the others stay
      expect(screen.getByText('Put back 2 fixes?')).toBeInTheDocument();
      expect(screen.getByText(/The other 6 fixes stay applied/)).toBeInTheDocument();
      expect(api.undoScheduleFixProposal).not.toHaveBeenCalled();

      api.undoScheduleFixProposal.mockResolvedValueOnce({
        score: 40, putBack: 2, stillApplied: ['d3', 'd4', 'd5', 'd6', 'd7', 'd8'], alsoPutBack: [], finishBefore: '2026-11-16', finishAfter: '2026-11-12', everything: false,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 2' }));
      await waitFor(() => expect(api.undoScheduleFixProposal).toHaveBeenCalledWith('s1', 'prop-1', ['d1', 'd2']));
      expect(await screen.findByText(/^Put back 2 of 8 fixes; project finish back to /)).toBeInTheDocument();
      expect(screen.getByText('Score 58 → 40. 6 fixes are still applied.')).toBeInTheDocument();
      expect(screen.getByText('Still applied (6)')).toBeInTheDocument();

      // "Undo more…" goes back to the list, now of the 6 that stay
      fireEvent.click(screen.getByRole('button', { name: 'Undo more…' }));
      expect(screen.getAllByRole('checkbox', { name: /^Put back:/ })).toHaveLength(6);
      expect(screen.queryByLabelText(/Put back: Link 'Build 1'/)).toBeNull();
    });

    it('a kept fix that relied on one put back is reported as put back too', async () => {
      await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      api.undoScheduleFixProposal.mockResolvedValueOnce({ score: 50, putBack: 2, stillApplied: ['d3', 'd4', 'd5', 'd6', 'd7', 'd8'], alsoPutBack: ['d2'], finishBefore: '2026-11-16', finishAfter: '2026-11-16', everything: false });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 1' }));
      expect(await screen.findByText('1 other fix relied on the ones you chose, so it was put back too.')).toBeInTheDocument();
      expect(screen.getByText(/^Put back 2 of 8 fixes; project finish stays /)).toBeInTheDocument();
    });

    it('Escape closes only the question and puts focus back on the button; the panel stays open', async () => {
      const onClose = await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 3'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      expect(screen.getByRole('button', { name: 'Keep them' })).toHaveFocus();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByText('Put back 1 fix?')).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
      expect(api.undoScheduleFixProposal).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Undo selected (1)' })).toHaveFocus();
    });

    it('Select all / Select none, and ticking every fix then putting them back is the whole undo', async () => {
      await applyAll();
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      expect(screen.getByRole('button', { name: 'Undo selected (8)' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
      expect(screen.getByRole('button', { name: 'Undo selected (0)' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (8)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 8' }));
      await waitFor(() => expect(api.undoScheduleFixProposal).toHaveBeenCalledWith('s1', 'prop-1', undefined));
      expect(await screen.findByText('Undone — the 8 fixes you applied were removed.')).toBeInTheDocument();
    });

    it('when the fixes that were to stay could not be applied again, the screen shows the plan as it now is (all put back) with the reason', async () => {
      await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      api.undoScheduleFixProposal.mockRejectedValueOnce({ response: { status: 409, data: { error: 'The fixes you kept could not be applied again, so all 8 fixes were put back. review timed out', code: 'reapply_failed' } } });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 1' }));
      expect(await screen.findByText(/so all 8 fixes were put back/)).toBeInTheDocument();
      expect(screen.getByText('Undone — the 8 fixes you applied were removed.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Undo selected/ })).toBeNull(); // nothing left to put back
    });

    it('when some steps could not be reversed the banner does not claim a clean undo', async () => {
      await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      api.undoScheduleFixProposal.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Everything was put back except 1 step that could not be reversed. Check the plan.', code: 'revert_incomplete' } } });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 1' }));
      expect(await screen.findByText(/except 1 step that could not be reversed/)).toBeInTheDocument();
      expect(screen.getByText(/Put back, except for a few steps that failed/)).toBeInTheDocument();
      expect(screen.queryByText(/^Undone — the 8 fixes/)).toBeNull();
    });

    it('while the undo runs the list cannot be changed and the buttons wait', async () => {
      await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      let finish!: (v: unknown) => void;
      api.undoScheduleFixProposal.mockImplementationOnce(() => new Promise(r => { finish = r as (v: unknown) => void; }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 1' }));
      expect(await screen.findByRole('button', { name: 'Putting back…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Keep them' })).toBeDisabled();
      finish({ score: 50, putBack: 1, stillApplied: ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'], alsoPutBack: [], finishBefore: null, finishAfter: null, everything: false });
      expect(await screen.findByText(/^Put back 1 of 8 fixes/)).toBeInTheDocument();
    });

    it('a fix the Apply skipped is not offered to put back', async () => {
      api.applyScheduleFixes.mockResolvedValueOnce({ beforeScore: 17, afterScore: 58, appliedCount: 7, datesMoved: 0, dateDeltas: [], skipped: [{ fixId: 'd8', reason: 'already linked' }] });
      await applyAll();
      expect(screen.getAllByRole('checkbox', { name: /^Put back:/ })).toHaveLength(7);
      expect(screen.getByRole('button', { name: 'Undo all (7)' })).toBeInTheDocument();
    });

    it('the server refusing (something changed since) shows its words', async () => {
      await applyAll();
      fireEvent.click(screen.getByLabelText(/Put back: Link 'Build 1'/));
      fireEvent.click(screen.getByRole('button', { name: 'Undo selected (1)' }));
      api.undoScheduleFixProposal.mockRejectedValueOnce({ response: { data: { error: 'not_latest', message: 'Something changed after this Apply, so it can no longer be undone from here.' } } });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, put back 1' }));
      expect(await screen.findByText(/can no longer be undone from here/)).toBeInTheDocument();
    });
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
