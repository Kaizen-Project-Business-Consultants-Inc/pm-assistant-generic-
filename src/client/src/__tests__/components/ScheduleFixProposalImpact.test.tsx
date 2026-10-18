import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Propose fixes, 2026-10-18 (UAT: "Select all in Critical" took 12 links between overlapping
 * tasks and pushed the finish out eight months; 38 problems had no fix and no word about them).
 */
const api = vi.hoisted(() => ({
  proposeScheduleFixes: vi.fn(),
  applyScheduleFixes: vi.fn(),
  undoScheduleFixProposal: vi.fn(),
  rejectScheduleFixProposal: vi.fn(),
  previewScheduleFixes: vi.fn(),
  getScheduleChanges: vi.fn(),
  undoScheduleChange: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleFixProposalPanel } from '../../components/schedule/review/ScheduleFixProposalPanel';

const link = (i: number, overlaps: boolean) => ({
  id: `d${i}`, type: 'add_dependency', confidence: overlaps ? 0.5 : 0.75, reason: 'seq', defaultChecked: false, severity: 'critical', overlaps,
  taskId: `b${i}`, taskName: `Build ${i}`, dependsOnTaskId: `a${i}`, dependsOnTaskName: `Design ${i}`,
});
const PROPOSAL = {
  id: 'prop-1', source: 'rules',
  proposalData: {
    fixes: [link(1, false), link(2, false), link(3, true), link(4, true)],
    needsDecision: [
      { ruleId: 'R06', rule: 'Dates outside project window', severity: 'high', taskIds: ['t1', 't2'], message: 'x' },
      { ruleId: 'R10', rule: 'No owner', severity: 'medium', taskIds: ['t3'], message: 'x' },
      { ruleId: 'R18', rule: 'No baseline', severity: 'medium', taskIds: [], message: 'x' },
      { ruleId: 'R99', rule: 'Something else', severity: 'low', taskIds: ['t4'], message: 'The review says so.' },
    ],
  },
};
// The dry run: the two overlapping links push the finish 4 weeks, past the project end
const preview = (ids: string[]) => {
  const overlapping = ids.filter(id => id === 'd3' || id === 'd4').length;
  return {
    tasksMoved: overlapping * 3, finishBefore: '2027-01-15', finishAfter: overlapping ? '2027-02-12' : '2027-01-15',
    finishShiftDays: overlapping ? 28 : 0, projectEnd: '2027-01-31', scoreBefore: 19, scoreAfter: 40,
  };
};

function renderPanel(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleFixProposalPanel scheduleId="s1" projectId="p1" onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.proposeScheduleFixes.mockResolvedValue(PROPOSAL);
  api.previewScheduleFixes.mockImplementation(async (_s: string, _p: string, ids: string[]) => preview(ids));
  api.getScheduleChanges.mockResolvedValue([{ id: 'c1', kind: 'review_fix', undoable: true }]);
  api.undoScheduleChange.mockResolvedValue({});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Propose fixes — links between tasks that run at the same time', () => {
  it('are their own group, left out of "Select all in" and "Select all", with their own tick', async () => {
    renderPanel();
    expect(await screen.findByText('2 links follow your dates — no dates move')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Critical: links between tasks that run at the same time' });

    fireEvent.click(screen.getByLabelText('Select all in Critical'));
    expect(screen.getByRole('button', { name: 'Apply 2 fixes (2 critical)' })).toBeInTheDocument();
    expect((within(group).getByLabelText(/Select: Link 'Build 3'/) as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Apply 2 fixes (2 critical)' })).toBeInTheDocument();

    fireEvent.click(within(group).getByLabelText('Link these 2 too'));
    expect(screen.getByRole('button', { name: 'Apply 4 fixes (4 critical)' })).toBeInTheDocument();
  });

  it('say what linking them does to the finish, asked once for the group', async () => {
    renderPanel();
    expect(await screen.findByText('Linking them puts them one after the other: the finish moves from Jan 15, 2027 to Feb 12, 2027 (+4 weeks) — past the project end (Jan 31, 2027).')).toBeInTheDocument();
    expect(api.previewScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['d3', 'd4'], undefined);
  });
});

describe('Propose fixes — "If you apply what is ticked"', () => {
  it('shows score and finish before → after for the ticked fixes, red past the project end', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText('Link these 2 too'));
    fireEvent.click(screen.getByLabelText(/Select: Link 'Build 1'/));
    await screen.findByText('If you apply what is ticked');
    const status = screen.getByTestId('fix-impact');
    await waitFor(() => expect(within(status).getByText(/Score 19 →/)).toBeInTheDocument(), { timeout: 2000 });
    expect(api.previewScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['d1', 'd3', 'd4'], undefined);
    const finish = within(status).getByText(/^Finish Jan 15, 2027 →/);
    expect(finish).toHaveTextContent('Finish Jan 15, 2027 → Feb 12, 2027 (+4 weeks) — past the project end, Jan 31, 2027');
    expect(finish.className).toMatch(/text-red-700/);
    expect(within(status).getByText('6 tasks move.')).toBeInTheDocument();
    // never blocks Apply
    expect(screen.getByRole('button', { name: 'Apply 3 fixes (3 critical)' })).toBeEnabled();
  });

  it('a screen reader hears one sentence, from a live region that is always there', async () => {
    renderPanel();
    await screen.findByLabelText('Link these 2 too');
    const live = screen.getAllByRole('status').find(el => el.className.includes('sr-only'))!;
    expect(live).toHaveTextContent('');
    fireEvent.click(screen.getByLabelText('Link these 2 too'));
    await waitFor(() => expect(live).toHaveTextContent('If applied: score 19 to 40, finish Feb 12, 2027, past the project end, 6 tasks move.'), { timeout: 2000 });
  });

  it('sends the name typed for a ticked rename with the question', async () => {
    api.proposeScheduleFixes.mockResolvedValue({
      ...PROPOSAL,
      proposalData: { ...PROPOSAL.proposalData, fixes: [{ id: 'r1', type: 'rename_task', confidence: 0.6, reason: 'code', defaultChecked: false, severity: 'low', taskId: 'h1', taskName: 'T1', newName: 'Task 1' }] },
    });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('New name for T1'), { target: { value: ' Kick-off ' } });
    fireEvent.click(screen.getByLabelText("Select: rename 'T1'"));
    await waitFor(() => expect(api.previewScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['r1'], { r1: 'Kick-off' }), { timeout: 2000 });
  });

  it('more than 200 overlapping links: the group is worked out for the first 200, and says so', async () => {
    api.proposeScheduleFixes.mockResolvedValue({ id: 'prop-1', source: 'rules', proposalData: { fixes: Array.from({ length: 201 }, (_, i) => link(i + 10, true)) } });
    renderPanel();
    expect(await screen.findByText(/^For the first 200 of them: Linking them/)).toBeInTheDocument();
    const ids = api.previewScheduleFixes.mock.calls[0][2] as string[];
    expect(ids).toHaveLength(200);
  });

  it('waits for the ticking to stop, and does not ask again for a selection it has answered', async () => {
    renderPanel();
    fireEvent.click(await screen.findByLabelText(/Select: Link 'Build 1'/));
    await waitFor(() => expect(api.previewScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['d1'], undefined), { timeout: 2000 });
    const asked = api.previewScheduleFixes.mock.calls.length;
    // tick and untick another inside the wait: back where it was, nothing new to ask
    fireEvent.click(screen.getByLabelText(/Select: Link 'Build 2'/));
    fireEvent.click(screen.getByLabelText(/Select: Link 'Build 2'/));
    await new Promise(r => { setTimeout(r, 1000); });
    expect(api.previewScheduleFixes.mock.calls.length).toBe(asked);
  });

  it('hides the box when the preview fails', async () => {
    api.previewScheduleFixes.mockRejectedValue(new Error('429'));
    renderPanel();
    fireEvent.click(await screen.findByLabelText(/Select: Link 'Build 1'/));
    await waitFor(() => expect(api.previewScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['d1'], undefined), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByText('If you apply what is ticked')).not.toBeInTheDocument());
  });

  it('after Apply: the finish before → after, and a warning past the project end', async () => {
    api.applyScheduleFixes.mockResolvedValue({
      beforeScore: 19, afterScore: 40, appliedCount: 4, skipped: [], datesMoved: 6, dateDeltas: [],
      projectEndBefore: '2027-01-15', projectEndAfter: '2027-02-12', projectEndShiftDays: 28, projectEnd: '2027-01-31',
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: /^Apply 2 fixes/ }));
    expect(await screen.findByText('Finish Jan 15, 2027 → Feb 12, 2027 (+4 weeks)')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The plan now finishes after the project’s end date (Jan 31, 2027).');
  });
});

describe('Propose fixes — Needs your decision', () => {
  it('lists what no fix answers, by rule, with a plain sentence and its level', async () => {
    renderPanel();
    const section = await screen.findByRole('region', { name: 'Needs your decision' });
    expect(within(section).getByText('These tasks end after the project’s end date. Move the end date, or undo the last Apply if it pushed them.')).toBeInTheDocument();
    expect(within(section).getByText('No one is named to do these tasks.')).toBeInTheDocument();
    expect(within(section).getByText('The review says so.')).toBeInTheDocument(); // a rule with no plain sentence: the review's own
    expect(within(section).getAllByText('High')).toHaveLength(1);
  });

  it('its buttons open the existing screens', async () => {
    const onHighlightTasks = vi.fn();
    const onEditProject = vi.fn();
    const onSaveBaseline = vi.fn(async () => ({}));
    renderPanel({ onHighlightTasks, onEditProject, onSaveBaseline });
    const section = await screen.findByRole('region', { name: 'Needs your decision' });

    fireEvent.click(within(section).getByRole('button', { name: 'Show the 2 in the plan' }));
    expect(onHighlightTasks).toHaveBeenLastCalledWith(['t1', 't2']);
    fireEvent.click(within(section).getByRole('button', { name: 'Assign owners… (show the 1)' }));
    expect(onHighlightTasks).toHaveBeenLastCalledWith(['t3']);
    fireEvent.click(within(section).getByRole('button', { name: 'Open these tasks' }));
    expect(onHighlightTasks).toHaveBeenLastCalledWith(['t4']);

    fireEvent.click(within(section).getByRole('button', { name: 'Edit project end date' }));
    expect(onEditProject).toHaveBeenCalled();

    fireEvent.click(within(section).getByRole('button', { name: 'Save a baseline now' }));
    expect(await within(section).findByText('Baseline saved.')).toBeInTheDocument();
    expect(onSaveBaseline).toHaveBeenCalledTimes(1);

    fireEvent.click(await within(section).findByRole('button', { name: 'Undo the last Apply' }));
    await waitFor(() => expect(api.undoScheduleChange).toHaveBeenCalledWith('s1', 'c1'));
    await waitFor(() => expect(api.proposeScheduleFixes).toHaveBeenCalledTimes(2)); // fresh suggestions afterwards
  });

  it('offers Undo only when the newest History change is an Apply of fixes; no Edit project without the right', async () => {
    api.getScheduleChanges.mockResolvedValue([{ id: 'c9', kind: 'task_edit', undoable: true }]);
    renderPanel();
    const section = await screen.findByRole('region', { name: 'Needs your decision' });
    await waitFor(() => expect(api.getScheduleChanges).toHaveBeenCalled());
    expect(within(section).queryByRole('button', { name: 'Undo the last Apply' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Edit project end date' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Save a baseline now' })).not.toBeInTheDocument();
  });
});
