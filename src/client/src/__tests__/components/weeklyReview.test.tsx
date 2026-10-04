import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getPmWeeklyReview: vi.fn(),
  runPmWeeklyReview: vi.fn(),
  dismissPmWeeklyReviewItem: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { WeeklyReviewView } from '../../components/weeklyReview/WeeklyReviewView';
import { WeeklyReviewCard } from '../../components/weeklyReview/WeeklyReviewCard';
import { openDecisions, type WeeklyReview } from '../../components/weeklyReview/weeklyReviewTypes';

const review: WeeklyReview = {
  id: 'rv1',
  projectId: 'p1',
  projectName: 'DBJ-Loans',
  weekStart: '2026-10-05',
  asOf: '2026-10-09',
  rag: 'red',
  ragReason: 'because of the finish date',
  items: [
    {
      key: 'delay:t1', kind: 'finish_at_risk', level: 'red', label: 'Finish date at risk', area: 'schedule', measure: 5,
      headline: '"UAT test scripts" is 5 working days behind and is on the critical path — the finish date moves with it.',
      suggestion: 'Recover it within the plan first.', facts: ['40% done — behind where it should be by now (working days)'],
      refs: { taskId: 't1', scheduleId: 's1' },
    },
    {
      key: 'overload:r1', kind: 'overloaded', level: 'amber', label: 'Someone is overloaded', area: 'resources', measure: 8,
      headline: 'Peter is over their hours in the week of 12 Oct (48 h of 40), all projects counted.',
      suggestion: 'Move a task that has slack a week later.', facts: ['Week of 12 Oct: 48 h booked, 40 h available'],
    },
  ],
  fine: [{ label: 'On budget', level: 'green', detail: 'cost efficiency 1.02, forecast $4,800 under' }],
  uncertainty: ["2 tasks in progress haven't been updated for over two weeks, so their progress may be out of date."],
  moreFound: 1,
  quietened: 0,
  trigger: 'friday',
  createdAt: '2026-10-09T05:00:00Z',
  responses: [],
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.getPmWeeklyReview.mockResolvedValue({ review });
  api.runPmWeeklyReview.mockResolvedValue({ review: { ...review, id: 'rv2', items: [], rag: 'green', moreFound: 0 } });
  api.dismissPmWeeklyReviewItem.mockResolvedValue({ responses: [{ itemKey: 'overload:r1', response: 'dismissed', reason: 'already_handled', createdAt: '2026-10-09T06:00:00Z' }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Weekly PM review — full view', () => {
  it('shows the decisions first, then what is fine, the uncertainty and the status colour', async () => {
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: /Your week on DBJ-Loans — 2 decisions needed/ })).toBeTruthy();
    expect(screen.getByText('1 · Finish date at risk')).toBeTruthy();
    expect(screen.getByText('2 · Someone is overloaded')).toBeTruthy();
    expect(screen.getByText(/1 smaller thing was left off/)).toBeTruthy();
    expect(screen.getByText('On budget')).toBeTruthy();
    expect(screen.getByText(/haven't been updated for over two weeks/)).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
  });

  it('"Why?" shows the facts and is a proper toggle for screen readers', async () => {
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={vi.fn()} />);
    const why = (await screen.findAllByRole('button', { name: 'Why?' }))[0];
    expect(why.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/40% done/)).toBeNull();
    fireEvent.click(why);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/40% done/)).toBeTruthy();
  });

  it('the main button opens the tab where the problem is fixed', async () => {
    const onNavigateToTab = vi.fn();
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={onNavigateToTab} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the schedule' }));
    expect(onNavigateToTab).toHaveBeenCalledWith('schedule');
    fireEvent.click(screen.getByRole('button', { name: 'Open resources' }));
    expect(onNavigateToTab).toHaveBeenCalledWith('resources');
  });

  it('Dismiss asks why, saves the reason, and the item folds away', async () => {
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={vi.fn()} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Dismiss' }))[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Already handled' }));
    await waitFor(() => expect(api.dismissPmWeeklyReviewItem).toHaveBeenCalledWith('p1', 'rv1', 'overload:r1', 'already_handled'));
    expect(await screen.findByText(/dismissed \(Already handled\)/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /1 decision needed/ })).toBeTruthy();
  });

  it('never run: explains it and offers to run it now', async () => {
    api.getPmWeeklyReview.mockResolvedValue({ review: null });
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run my weekly review' }));
    expect(await screen.findByRole('heading', { name: /all fine/ })).toBeTruthy();
    expect(api.runPmWeeklyReview).toHaveBeenCalledWith('p1');
  });

  it('a failed run says so in plain words', async () => {
    api.runPmWeeklyReview.mockRejectedValue({ response: { data: { message: 'Failed to run the weekly review' } } });
    wrap(<WeeklyReviewView projectId="p1" onBack={vi.fn()} onNavigateToTab={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run again' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('Weekly PM review — overview card', () => {
  it('says how many decisions are open and opens the review', async () => {
    const onOpen = vi.fn();
    wrap(<WeeklyReviewCard projectId="p1" onOpen={onOpen} />);
    expect(await screen.findByText(/2 decisions open/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('never run: no Open button, Run opens the result', async () => {
    api.getPmWeeklyReview.mockResolvedValue({ review: null });
    const onOpen = vi.fn();
    wrap(<WeeklyReviewCard projectId="p1" onOpen={onOpen} />);
    await screen.findByText(/It runs every Friday, or now/);
    expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run my weekly review' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
  });
});

describe('openDecisions', () => {
  it('leaves out items already dismissed or applied', () => {
    expect(openDecisions({ ...review, responses: [{ itemKey: 'delay:t1', response: 'applied', reason: null, createdAt: '' }] }).map(i => i.key)).toEqual(['overload:r1']);
  });
});
