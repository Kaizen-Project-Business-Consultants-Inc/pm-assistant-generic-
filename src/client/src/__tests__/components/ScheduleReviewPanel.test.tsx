import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getScheduleReviewLatest: vi.fn(),
  getScheduleReviewHistory: vi.fn(),
  reviewSchedule: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleReviewPanel, type ScheduleReview } from '../../components/schedule/review/ScheduleReviewPanel';
import { ScheduleScoreChip } from '../../components/schedule/review/ScheduleScoreChip';

const review: ScheduleReview = {
  id: 'rv1',
  scheduleId: 's1',
  score: 16,
  band: 'tracking_sheet',
  counts: { critical: 1, high: 2, medium: 1, low: 0, info: 1 },
  leafTaskCount: 28,
  findings: [
    { ruleId: 'R03', rule: 'No logic at all', severity: 'critical', taskIds: [], message: 'None of the 28 tasks are linked.', pointsDeducted: 25 },
    { ruleId: 'R04', rule: 'Milestone with duration', severity: 'high', taskIds: ['g1'], message: "'Gate 1' spans 10 days.", pointsDeducted: 3 },
    { ruleId: 'R06', rule: 'Dates outside project window', severity: 'high', taskIds: ['k1'], message: "'Kick-Off' starts 2026-06-12, project starts 2026-07-06.", pointsDeducted: 3 },
    { ruleId: 'R10', rule: 'No owner', severity: 'medium', taskIds: ['a', 'b'], message: '2 of 28 tasks have no owner.', pointsDeducted: 0.4 },
    { ruleId: 'R27', rule: 'No description', severity: 'info', taskIds: ['a'], message: '1 of 28 tasks have no description.', pointsDeducted: 0 },
  ],
  skippedRules: [
    { ruleId: 'R01', rule: 'Missing predecessor', reason: 'covered_by_R03' },
    { ruleId: 'R15', rule: 'Negative float', reason: 'needs_logic' },
  ],
  trigger: 'manual',
  rulesVersion: '1.0',
  createdAt: '2026-09-16T20:00:00Z',
};

function renderPanel(props: Partial<React.ComponentProps<typeof ScheduleReviewPanel>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onShowRows = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <ScheduleReviewPanel scheduleId="s1" canEdit onClose={onClose} onShowRows={onShowRows} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onShowRows, onClose };
}

beforeEach(() => {
  api.getScheduleReviewLatest.mockResolvedValue(review);
  api.getScheduleReviewHistory.mockResolvedValue({ runs: [
    { id: 'rv1', score: 16, band: 'tracking_sheet', counts: review.counts, trigger: 'manual', createdAt: '2026-09-16T20:00:00Z' },
    { id: 'rv0', score: 9, band: 'tracking_sheet', counts: review.counts, trigger: 'import', createdAt: '2026-09-16T19:00:00Z' },
  ] });
  api.reviewSchedule.mockResolvedValue({ ...review, id: 'rv2', score: 22 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ScheduleReviewPanel', () => {
  it('renders the score, groups findings by severity and opens Critical/High by default', async () => {
    renderPanel();
    expect(await screen.findByText('No logic at all')).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('Tracking sheet')).toBeInTheDocument();
    expect(screen.getByText('Milestone with duration')).toBeInTheDocument();
    // Medium is collapsed by default
    expect(screen.queryByText('No owner')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Medium/ }));
    expect(screen.getByText('No owner')).toBeInTheDocument();
  });

  it('Show rows passes the finding task ids and label', async () => {
    const { onShowRows } = renderPanel();
    await screen.findByText('No logic at all');
    // R04 and R06 each flag one task; the first button belongs to R04 (findings are in severity order)
    fireEvent.click(screen.getAllByRole('button', { name: 'Show 1 row' })[0]);
    expect(onShowRows).toHaveBeenCalledWith(['g1'], 'Milestone with duration');
  });

  it('lists rules that unlock when dependencies exist, not the R03-covered ones', async () => {
    renderPanel();
    await screen.findByText('No logic at all');
    expect(screen.getByText('Negative float')).toBeInTheDocument();
    expect(screen.queryByText('Missing predecessor')).not.toBeInTheDocument();
  });

  it('re-runs the review on demand and updates the score', async () => {
    renderPanel();
    await screen.findByText('No logic at all');
    fireEvent.click(screen.getByRole('button', { name: /Re-run review/ }));
    await waitFor(() => expect(api.reviewSchedule).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('22')).toBeInTheDocument();
  });

  it('runs a first review automatically when none is stored and the user can edit', async () => {
    api.getScheduleReviewLatest.mockResolvedValueOnce(null);
    renderPanel();
    await waitFor(() => expect(api.reviewSchedule).toHaveBeenCalledTimes(1));
  });

  it('does not auto-run for read-only users and hides the re-run button', async () => {
    api.getScheduleReviewLatest.mockResolvedValueOnce(null);
    renderPanel({ canEdit: false });
    await screen.findByText('No review yet');
    expect(api.reviewSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Re-run review/ })).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const { onClose } = renderPanel();
    await screen.findByText('No logic at all');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ScheduleScoreChip', () => {
  it('announces the score for screen readers', () => {
    render(<ScheduleScoreChip score={72} band="controllable" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveAttribute('aria-label', 'Schedule health score 72 out of 100, Controllable');
    expect(chip).toHaveTextContent('72');
    expect(chip).toHaveTextContent('Controllable');
  });

  it('is a button when clickable', () => {
    const onClick = vi.fn();
    render(<ScheduleScoreChip score={5} band="tracking_sheet" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
