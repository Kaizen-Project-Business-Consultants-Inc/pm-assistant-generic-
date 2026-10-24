import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The Propose fixes button says what is left (2026-10-24): "Propose fixes" until a proposal has been made,
 * then "Decisions needed (N)" when only decisions remain, or a greyed "Nothing to propose" (still reachable
 * by keyboard) when nothing does and the AI suggestions were tried too. A new review forgets it.
 */
const api = vi.hoisted(() => ({
  getScheduleReviewLatest: vi.fn(),
  getScheduleReviewHistory: vi.fn(),
  reviewSchedule: vi.fn(),
  proposeScheduleFixes: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleReviewPanel, type ScheduleReview } from '../../components/schedule/review/ScheduleReviewPanel';

const review: ScheduleReview = {
  id: 'rv1', scheduleId: 's1', score: 60, band: 'tracking_sheet',
  counts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, leafTaskCount: 10,
  findings: [{ ruleId: 'R04', rule: 'Milestone with duration', severity: 'high', taskIds: ['g1'], message: "'Gate 1' spans 10 days.", pointsDeducted: 3 }],
  skippedRules: [], trigger: 'manual', rulesVersion: '1.0', createdAt: '2026-10-24T10:00:00Z',
};
const decision = { ruleId: 'R04', rule: 'Milestone with duration', severity: 'high', taskIds: ['g1'], message: "'Gate 1' spans 10 days." };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ScheduleReviewPanel scheduleId="s1" projectId="p1" canEdit onClose={vi.fn()} onShowRows={vi.fn()} />
    </QueryClientProvider>,
  );
}
const proposalWith = (fixes: unknown[], needsDecision: unknown[]) => ({ id: 'p1', source: 'rules', proposalData: { fixes, needsDecision } });
// the panel's X (a second "Close" sits in its footer when there are no fixes)
const closeFixes = () => fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Propose fixes button states', () => {
  it('says "Propose fixes" before any proposal, and when fixes are offered', async () => {
    api.getScheduleReviewLatest.mockResolvedValue(review);
    api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
    api.proposeScheduleFixes.mockResolvedValue(proposalWith([{ id: 'f1', type: 'set_milestone', confidence: 0.9, reason: 'r', defaultChecked: false, severity: 'high', taskName: 'Gate 1' }], []));
    renderPanel();
    const button = await screen.findByRole('button', { name: 'Propose fixes' });
    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'Propose fixes' });
    closeFixes();
    expect(await screen.findByRole('button', { name: 'Propose fixes' })).toBeInTheDocument();
  });

  it('only decisions left: "Decisions needed (N)", which opens the panel with the plain line', async () => {
    api.getScheduleReviewLatest.mockResolvedValue(review);
    api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
    api.proposeScheduleFixes.mockResolvedValue(proposalWith([], [decision, { ...decision, taskIds: ['g2'] }]));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    expect(await screen.findByText('No more fixes to propose. These need your decision.')).toBeInTheDocument();
    closeFixes();
    const button = await screen.findByRole('button', { name: 'Decisions needed (2)' });
    fireEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'Propose fixes' })).toBeInTheDocument();
  });

  it('nothing left: greyed "Nothing to propose", reachable by keyboard, does nothing when pressed', async () => {
    api.getScheduleReviewLatest.mockResolvedValue(review);
    api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
    api.proposeScheduleFixes.mockResolvedValue(proposalWith([], []));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    await screen.findByText(/Nothing to propose\. The schedule already has/);
    // the rules found nothing, but the AI suggestions (inside the panel) were not tried: the button must still open the panel
    closeFixes();
    expect(await screen.findByRole('button', { name: 'Propose fixes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Propose fixes' }));
    fireEvent.click(await screen.findByRole('button', { name: /AI suggestions/ }));
    await screen.findByText(/No AI suggestions this time/);
    closeFixes();
    const off = await screen.findByRole('button', { name: 'Nothing to propose' });
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).not.toBeDisabled();
    expect(off).toHaveAccessibleDescription('The review found nothing to fix or decide. Click Re-run review after you change the plan.');
    fireEvent.click(off);
    expect(screen.queryByRole('dialog', { name: 'Propose fixes' })).not.toBeInTheDocument();
  });

  it('a new review forgets it: the button goes back to "Propose fixes"', async () => {
    api.getScheduleReviewLatest.mockResolvedValue(review);
    api.getScheduleReviewHistory.mockResolvedValue({ runs: [] });
    api.proposeScheduleFixes.mockResolvedValue(proposalWith([], []));
    api.reviewSchedule.mockResolvedValue({ ...review, id: 'rv2' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Propose fixes' }));
    await screen.findByText(/Nothing to propose\. The schedule already has/);
    fireEvent.click(await screen.findByRole('button', { name: /AI suggestions/ }));
    await screen.findByText(/No AI suggestions this time/);
    closeFixes();
    await screen.findByRole('button', { name: 'Nothing to propose' });
    fireEvent.click(screen.getByRole('button', { name: 'Re-run review' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Propose fixes' })).toBeInTheDocument());
  });
});
