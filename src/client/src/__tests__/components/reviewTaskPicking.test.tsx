import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Picking tasks out of a review (U81, 2026-10-24): tick findings or tasks, click one to light its rows
 * up in the plan, delete the ticked tasks after one question; Propose fixes says how many findings
 * became how many fixes and decisions, and each decision lists its tasks.
 */
const api = vi.hoisted(() => ({
  getScheduleReviewLatest: vi.fn(),
  getScheduleReviewHistory: vi.fn(),
  reviewSchedule: vi.fn(),
  proposeScheduleFixes: vi.fn(),
  getScheduleChanges: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleReviewPanel, type ScheduleReview } from '../../components/schedule/review/ScheduleReviewPanel';

const IDS = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
const review: ScheduleReview = {
  id: 'rv1', scheduleId: 's1', score: 40, band: 'tracking_sheet',
  counts: { critical: 0, high: 1, medium: 1, low: 0, info: 0 }, leafTaskCount: 12,
  findings: [
    { ruleId: 'R06', rule: 'Dates outside project window', severity: 'high', taskIds: IDS, message: '10 tasks start or end outside the project.', pointsDeducted: 3 },
    { ruleId: 'R10', rule: 'No owner', severity: 'medium', taskIds: ['t1'], message: '1 task has no owner.', pointsDeducted: 1 },
  ],
  skippedRules: [], trigger: 'manual', rulesVersion: '1.0', createdAt: '2026-10-24T10:00:00Z',
};
const taskInfoOf = (id: string) => ({ name: `Task ${id}`, startDate: '2026-10-12', endDate: id === 't10' ? '2027-04-16' : '2027-01-10' });
const rowNumberOf = (id: string) => Number(id.slice(1));
const decisions = [
  { ruleId: 'R06', rule: 'Dates outside project window', severity: 'high', taskIds: IDS, message: 'x' },
  { ruleId: 'R10', rule: 'No owner', severity: 'medium', taskIds: ['t1'], message: 'y' },
];

function renderPanel(extra: Partial<React.ComponentProps<typeof ScheduleReviewPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = { onHighlightTasks: vi.fn(), onShowRows: vi.fn(), onDeleteTasks: vi.fn().mockResolvedValue(undefined), ...extra };
  render(
    <QueryClientProvider client={qc}>
      <ScheduleReviewPanel scheduleId="s1" projectId="p1" canEdit onClose={vi.fn()} taskInfoOf={taskInfoOf} rowNumberOf={rowNumberOf} {...props} />
    </QueryClientProvider>,
  );
  return props;
}
function setup() {
  api.getScheduleReviewLatest.mockResolvedValue(review);
  api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
  api.getScheduleChanges.mockResolvedValue([]);
  api.reviewSchedule.mockResolvedValue(review);
  api.proposeScheduleFixes.mockResolvedValue({ id: 'p1', source: 'rules', proposalData: { fixes: [], needsDecision: decisions } });
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Review panel: tick findings, delete their tasks', () => {
  it('"Select all in High" ticks every High finding; the bar counts findings and tasks', async () => {
    setup();
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all in High' }));
    expect(screen.getByText('1 finding ticked · 10 tasks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in High' }));
    expect(screen.queryByText(/ticked/)).not.toBeInTheDocument();
  });

  it('Delete asks first: Keep them deletes nothing, Yes deletes exactly the ticked tasks and clears the ticks', async () => {
    setup();
    const props = renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick: Dates outside project window, 10 tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 10 tasks…' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete tasks' })).toHaveTextContent('Delete 10 tasks? They are removed from the plan and recorded in Schedule History. Undo there puts them back.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(props.onDeleteTasks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 10 tasks…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete 10' }));
    await waitFor(() => expect(props.onDeleteTasks).toHaveBeenCalledWith(IDS));
    await waitFor(() => expect(screen.queryByText(/ticked/)).not.toBeInTheDocument());
  });

  it('a failed delete says so, keeps the ticks and the question open', async () => {
    setup();
    const props = renderPanel({ onDeleteTasks: vi.fn().mockRejectedValue(new Error('boom')) });
    fireEvent.click(await screen.findByRole('button', { name: /Medium/ })); // Medium starts closed
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick: No owner, 1 task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 task…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete 1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(props.onDeleteTasks).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 finding ticked · 1 task')).toBeInTheDocument();
  });

  it('someone who cannot edit gets no Delete button', async () => {
    setup();
    renderPanel({ canEdit: false });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick: Dates outside project window, 10 tasks' }));
    expect(screen.getByRole('button', { name: 'Show in plan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });
});

describe('Delete limits and keyboard', () => {
  it('more than 100 tasks ticked: no Delete button, and it says why', async () => {
    setup();
    const many = Array.from({ length: 101 }, (_, i) => `m${i}`);
    api.getScheduleReviewLatest.mockResolvedValue({ ...review, findings: [{ ...review.findings[0], taskIds: many }] });
    renderPanel({ taskInfoOf: id => ({ name: id }) });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all in High' }));
    expect(screen.getByText('Delete takes up to 100 tasks at a time. Tick fewer to delete.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in plan' })).toBeInTheDocument();
  });

  it('the question takes focus on Keep them; Escape cancels it (not the panel) and focus goes back to Delete', async () => {
    setup();
    renderPanel();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tick: Dates outside project window, 10 tasks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 10 tasks…' }));
    const keep = screen.getByRole('button', { name: 'Keep them' });
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.keyDown(keep, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Schedule Review' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete 10 tasks…' })).toHaveFocus());
  });

  it('unticking everything closes an open question', async () => {
    setup();
    renderPanel();
    const tick = await screen.findByRole('checkbox', { name: 'Tick: Dates outside project window, 10 tasks' });
    fireEvent.click(tick);
    fireEvent.click(screen.getByRole('button', { name: 'Delete 10 tasks…' }));
    fireEvent.click(tick);
    fireEvent.click(tick);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('tasks already deleted from the plan are not counted in a finding', async () => {
    setup();
    renderPanel({ taskInfoOf: id => (Number(id.slice(1)) > 4 ? taskInfoOf(id) : undefined) }); // t1..t4 gone
    expect(await screen.findByRole('checkbox', { name: 'Tick: Dates outside project window, 6 tasks' })).toBeInTheDocument();
  });
});

describe('Propose fixes: findings → decisions, each decision lists its tasks', () => {
  async function openPropose() {
    setup();
    const props = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    await screen.findByRole('dialog', { name: 'Propose fixes' });
    return props;
  }

  async function openPropose2(extra: Partial<React.ComponentProps<typeof ScheduleReviewPanel>>) {
    setup();
    const props = renderPanel(extra);
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    await screen.findByRole('dialog', { name: 'Propose fixes' });
    return props;
  }

  it('says how many findings became how many fixes and decisions', async () => {
    await openPropose();
    expect(await screen.findByText('2 findings → 0 fixes the app can make, 2 decisions for you.')).toBeInTheDocument();
  });

  it('lists the tasks with row numbers and dates, and says what span the project dates must take in', async () => {
    await openPropose();
    const list = await screen.findByRole('list', { name: 'Tasks: Dates outside project window' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(8); // first eight, then "Show all"
    expect(screen.getByText('These tasks run from Oct 12, 2026 to Apr 16, 2027.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 10 tasks' }));
    expect(within(list).getAllByRole('checkbox')).toHaveLength(10);
  });

  it('clicking a task lights its row up; Select all ticks every task; Delete removes them from the list', async () => {
    // the plan forgets a task once it is deleted, as the Schedule screen's task list does
    const gone = new Set<string>();
    const props = await openPropose2({ taskInfoOf: (id: string) => (gone.has(id) ? undefined : taskInfoOf(id)), onDeleteTasks: vi.fn(async (ids: string[]) => { ids.forEach(i => gone.add(i)); }) });
    const list = await screen.findByRole('list', { name: 'Tasks: Dates outside project window' });
    fireEvent.click(within(list).getByRole('button', { name: /Task t2/ }));
    expect(props.onHighlightTasks).toHaveBeenLastCalledWith(['t2']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all 10 tasks' }));
    expect(screen.getByText('10 tasks ticked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 10 tasks…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete 10' }));
    await waitFor(() => expect(props.onDeleteTasks).toHaveBeenCalledWith(IDS));
    // every task of both decisions is gone (t1 is in both), so nothing is left to decide
    await waitFor(() => expect(screen.queryByText(/Needs your decision/)).not.toBeInTheDocument());
    // the proposal is made again, and the summary no longer counts decisions that are gone
    await waitFor(() => expect(api.proposeScheduleFixes).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/decisions? for you/)).not.toBeInTheDocument();
  });
});

describe('Propose fixes: overlap links and "Select all"', () => {
  const link = (id: string, overlaps: boolean) => ({ id, type: 'add_dependency', confidence: 0.9, reason: 'r', defaultChecked: false, severity: 'critical', taskId: `${id}a`, taskName: `A ${id}`, dependsOnTaskId: `${id}b`, dependsOnTaskName: `B ${id}`, overlaps });

  it('says Select all skips the overlap links, with the real count; hidden when there are none', async () => {
    setup();
    api.proposeScheduleFixes.mockResolvedValue({ id: 'p1', source: 'rules', proposalData: { fixes: [link('f1', false), link('f2', true), link('f3', true), link('f4', true)], needsDecision: [] } });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    expect(await screen.findByText('Select all skips the overlap links. Tick them one by one in the box below: 3 links between tasks that run at the same time.')).toBeInTheDocument();
    cleanup();
    setup();
    api.proposeScheduleFixes.mockResolvedValue({ id: 'p2', source: 'rules', proposalData: { fixes: [link('f1', false), link('f5', false)], needsDecision: [] } });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    await screen.findByRole('dialog', { name: 'Propose fixes' });
    expect(screen.queryByText(/Select all skips the overlap links/)).not.toBeInTheDocument();
  });
});
