import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getScheduleReviewLatest: vi.fn(),
  getScheduleReviewHistory: vi.fn(),
  reviewSchedule: vi.fn(),
  getScheduleSplitExceptions: vi.fn(),
  markTaskCannotBeSplit: vi.fn(),
  removeSplitException: vi.fn(),
  getPmNotFinished: vi.fn(),
  getReportingPeriodLimit: vi.fn(),
  getProjectSponsor: vi.fn(),
  getSponsorCandidates: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));
vi.mock('../../hooks/useClientChoice', () => ({
  useClientChoice: () => ({ clients: [], canManage: false, loading: false, listFailed: false, label: 'Client', word: { lower: 'client' }, resolveClientId: vi.fn() }),
}));

import { ScheduleReviewPanel, type ScheduleReview } from '../../components/schedule/review/ScheduleReviewPanel';
import { NotFinishedList } from '../../components/weeklyReview/NotFinishedList';
import { EditProjectModal } from '../../components/project/EditProjectModal';

const review: ScheduleReview = {
  id: 'rv1', scheduleId: 's1', score: 80, band: 'controllable',
  counts: { critical: 0, high: 0, medium: 2, low: 0, info: 0 }, leafTaskCount: 10,
  findings: [
    { ruleId: 'R42', rule: 'Tasks longer than one reporting period', severity: 'medium', taskIds: ['t14'], message: "'Build login screens': it runs 12 working days, and one reporting period (1 week) allows 5 working days. Split it by deliverable.", pointsDeducted: 1 },
    { ruleId: 'R42', rule: 'Tasks longer than one reporting period', severity: 'medium', taskIds: ['t22'], message: "'Data migration': its planned effort is 62 hours, and one reporting period allows 37.5 hours.", pointsDeducted: 1 },
  ],
  skippedRules: [], trigger: 'manual', rulesVersion: '1.12', createdAt: '2026-10-31T10:00:00Z',
};
const taskInfoOf = (id: string) => ({ name: id === 't14' ? 'Build login screens' : 'Data migration' });

function renderPanel(canEdit = true, onHighlightTasks = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScheduleReviewPanel scheduleId="s1" projectId="p1" canEdit={canEdit} onClose={vi.fn()} onShowRows={vi.fn()} onHighlightTasks={onHighlightTasks} taskInfoOf={taskInfoOf} />
    </QueryClientProvider>,
  );
  return { onHighlightTasks };
}

/** Medium findings start folded away like every other Medium group */
async function openMedium() {
  fireEvent.click(await screen.findByRole('button', { name: /Medium/ }));
}

beforeEach(() => {
  api.getScheduleReviewLatest.mockResolvedValue(review);
  api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
  api.getScheduleSplitExceptions.mockResolvedValue({ exceptions: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Schedule Review - tasks longer than one reporting period', () => {
  it('each finding says why and offers Go to task and Cannot be split', async () => {
    renderPanel();
    await openMedium();
    expect(await screen.findByText(/it runs 12 working days/)).toBeInTheDocument();
    expect(screen.getByText(/planned effort is 62 hours/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to task: Build login screens' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cannot be split: Data migration' })).toBeInTheDocument();
  });

  it('Go to task lights that task in the plan', async () => {
    const { onHighlightTasks } = renderPanel();
    await openMedium();
    fireEvent.click(await screen.findByRole('button', { name: 'Go to task: Data migration' }));
    expect(onHighlightTasks).toHaveBeenCalledWith(['t22']);
  });

  it('Cannot be split asks for a reason first, and saves nothing without one', async () => {
    renderPanel();
    await openMedium();
    fireEvent.click(await screen.findByRole('button', { name: 'Cannot be split: Data migration' }));
    const save = screen.getByRole('button', { name: 'Save exception' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why can it not be split/), { target: { value: 'ab' } });
    expect(save).toBeDisabled();
    expect(api.markTaskCannotBeSplit).not.toHaveBeenCalled();
  });

  it('saves the reason, then shows the task as an accepted exception and the fresh review', async () => {
    const after = { ...review, id: 'rv2', findings: [review.findings[0]] };
    api.markTaskCannotBeSplit.mockResolvedValue({
      review: after,
      exceptions: [{ taskId: 't22', taskName: 'Data migration', reason: 'One vendor cut-over weekend', createdByName: 'pm.person', createdAt: '2026-10-31T10:05:00.000Z' }],
    });
    renderPanel();
    await openMedium();
    fireEvent.click(await screen.findByRole('button', { name: 'Cannot be split: Data migration' }));
    fireEvent.change(screen.getByLabelText(/Why can it not be split/), { target: { value: 'One vendor cut-over weekend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save exception' }));
    await waitFor(() => expect(api.markTaskCannotBeSplit).toHaveBeenCalledWith('s1', 't22', 'One vendor cut-over weekend'));
    expect(await screen.findByText('Accepted exceptions (1)')).toBeInTheDocument();
    expect(screen.getByText('One vendor cut-over weekend')).toBeInTheDocument();
    expect(screen.getByText(/pm\.person/)).toBeInTheDocument();
    expect(screen.queryByText(/planned effort is 62 hours/)).not.toBeInTheDocument();
  });

  it('Remove puts the task back into the count', async () => {
    api.getScheduleSplitExceptions.mockResolvedValue({ exceptions: [{ taskId: 't22', taskName: 'Data migration', reason: 'One vendor cut-over weekend', createdByName: 'pm.person', createdAt: '2026-10-31T10:05:00.000Z' }] });
    api.removeSplitException.mockResolvedValue({ review, exceptions: [] });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove exception: Data migration' }));
    await waitFor(() => expect(api.removeSplitException).toHaveBeenCalledWith('s1', 't22'));
    await waitFor(() => expect(screen.queryByText('Accepted exceptions (1)')).not.toBeInTheDocument());
  });

  it('Escape cancels the reason box and returns to the button', async () => {
    renderPanel();
    await openMedium();
    const open = await screen.findByRole('button', { name: 'Cannot be split: Data migration' });
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByLabelText(/Why can it not be split/), { key: 'Escape' });
    expect(screen.queryByLabelText(/Why can it not be split/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cannot be split: Data migration' })).toHaveFocus());
  });

  it('a person who cannot edit gets Go to task but never Cannot be split, and no exceptions list', async () => {
    renderPanel(false);
    await openMedium();
    expect(await screen.findByRole('button', { name: 'Go to task: Build login screens' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cannot be split/ })).not.toBeInTheDocument();
    expect(api.getScheduleSplitExceptions).not.toHaveBeenCalled();
  });
});

describe('Weekly review - Not finished this period', () => {
  function renderList() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><NotFinishedList projectId="p1" /></QueryClientProvider>);
  }

  it('lists task, planned finish, status and owner; an open task past its finish reads Late', async () => {
    api.getPmNotFinished.mockResolvedValue({
      asOf: '2026-11-06', total: 2,
      tasks: [
        { taskId: 'a', scheduleId: 's1', name: 'Vendor sign-off', plannedFinish: '2026-11-04', status: 'in_progress', owner: 'Sam' },
        { taskId: 'b', scheduleId: 's1', name: 'Design review', plannedFinish: '2026-11-06', status: 'pending', owner: null },
      ],
    });
    renderList();
    expect(await screen.findByText('Vendor sign-off')).toBeInTheDocument();
    for (const h of ['Task', 'Planned finish', 'Status', 'Owner']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getAllByText('Late')).toHaveLength(2);
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    expect(screen.getByText(/Tasks that finished on time are not listed/)).toBeInTheDocument();
  });

  it('says so when everything is done, and when the list is cut off', async () => {
    api.getPmNotFinished.mockResolvedValueOnce({ asOf: '2026-11-06', total: 0, tasks: [] });
    renderList();
    expect(await screen.findByText(/Everything planned to finish by .* is done/)).toBeInTheDocument();
  });

  it('shows a plain message when it cannot load', async () => {
    api.getPmNotFinished.mockRejectedValue(new Error('nope'));
    renderList();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Edit project - reporting period', () => {
  function renderEdit(project: Record<string, unknown>, onSave = vi.fn()) {
    api.getProjectSponsor.mockResolvedValue({ sponsor: null });
    api.getSponsorCandidates.mockResolvedValue({ candidates: [] });
    api.getReportingPeriodLimit.mockImplementation(async (_id: string, period: string) => ({
      text: period === 'week' ? '5 working days / 37.5 hours' : period === 'two_weeks' ? '10 working days / 75 hours' : '21 working days / 157.5 hours',
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><EditProjectModal project={{ id: 'p1', name: 'Alpha', ...project }} onSave={onSave} onClose={vi.fn()} /></QueryClientProvider>);
    return { onSave };
  }

  it('shows the period, a read-only limit worked out by the server, and the switch', async () => {
    renderEdit({ reportingPeriod: 'week', periodRuleEnabled: true });
    const limit = await screen.findByLabelText('Limit used for this project');
    await waitFor(() => expect(limit).toHaveValue('5 working days / 37.5 hours'));
    expect(limit).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Warn about tasks longer than one reporting period')).toBeChecked();
    fireEvent.change(screen.getByLabelText('How often you report status'), { target: { value: 'two_weeks' } });
    await waitFor(() => expect(limit).toHaveValue('10 working days / 75 hours'));
  });

  it('an older project shows the switch off, and saving sends only what changed', async () => {
    const { onSave } = renderEdit({});
    const box = await screen.findByLabelText('Warn about tasks longer than one reporting period');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText('How often you report status'), { target: { value: 'month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ reportingPeriod: 'month', periodRuleEnabled: true }));
  });
});
