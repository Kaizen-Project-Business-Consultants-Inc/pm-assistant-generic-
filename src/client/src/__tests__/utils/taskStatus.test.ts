import { describe, it, expect } from 'vitest';
import { PICKABLE_STATUSES, STATUS_LABEL, effectiveTaskStatus, foldStatus, taskStatusLabel } from '../../utils/taskStatus';

describe('the task statuses a person can pick', () => {
  it('are exactly the five, in order, with their on-screen names', () => {
    expect([...PICKABLE_STATUSES]).toEqual(['pending', 'in_progress', 'late', 'completed', 'blocked']);
    expect(PICKABLE_STATUSES.map(s => STATUS_LABEL[s])).toEqual(['Not Started', 'On Track', 'Late', 'Completed', 'Blocked']);
  });
  it('show In Review and Testing as On Track, and keep older spellings readable', () => {
    expect(STATUS_LABEL.in_review).toBe('On Track');
    expect(STATUS_LABEL.testing).toBe('On Track');
    expect(STATUS_LABEL.done).toBe('Completed');
    expect(STATUS_LABEL.not_started).toBe('Not Started');
    expect(STATUS_LABEL.cancelled).toBe('Cancelled');
  });
});

describe('foldStatus', () => {
  it('folds the retired and older spellings into the five', () => {
    expect(foldStatus('in_review')).toBe('in_progress');
    expect(foldStatus('testing')).toBe('in_progress');
    expect(foldStatus('not_started')).toBe('pending');
    expect(foldStatus('done')).toBe('completed');
    expect(foldStatus(undefined)).toBe('pending');
    expect(foldStatus('blocked')).toBe('blocked');
  });
});

describe('effectiveTaskStatus — Late by itself', () => {
  const today = '2026-11-02'; // a Monday
  it('is not late on its last day, and late the day after', () => {
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: '2026-11-02' }, today)).toBe('in_progress');
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: '2026-11-01' }, today)).toBe('late');
  });
  it('makes a not-started task late once its finish has passed', () => {
    expect(effectiveTaskStatus({ status: 'pending', endDate: '2026-10-30' }, today)).toBe('late');
    expect(effectiveTaskStatus({ status: 'pending', endDate: '2026-11-05' }, today)).toBe('pending');
  });
  it('also covers In Review and Testing tasks (they show as late, not On Track)', () => {
    expect(effectiveTaskStatus({ status: 'testing', endDate: '2026-10-01' }, today)).toBe('late');
    expect(effectiveTaskStatus({ status: 'in_review', endDate: '2026-11-09' }, today)).toBe('in_progress');
  });
  it('never makes Completed, Blocked or Cancelled tasks late', () => {
    for (const status of ['completed', 'blocked', 'cancelled']) {
      expect(effectiveTaskStatus({ status, endDate: '2026-01-01' }, today)).toBe(status);
    }
  });
  it('keeps a status a PM set to Late by hand, even before the finish date', () => {
    expect(effectiveTaskStatus({ status: 'late', endDate: '2026-12-01' }, today)).toBe('late');
  });
  it('has nothing to compare when there is no end date', () => {
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: undefined }, today)).toBe('in_progress');
    expect(effectiveTaskStatus({ status: 'pending', endDate: null }, today)).toBe('pending');
  });
  it('works on calendar days: a weekend finish is late from Sunday on, a timestamp end counts by its day', () => {
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: '2026-10-31' }, '2026-11-01')).toBe('late'); // Saturday finish, Sunday viewer
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: '2026-11-02T23:30:00.000Z' }, today)).toBe('in_progress');
  });
  it('uses the viewer’s own day when none is given (not UTC)', () => {
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(effectiveTaskStatus({ status: 'in_progress', endDate: local })).toBe('in_progress');
  });
});

describe('taskStatusLabel', () => {
  it('names the effective status', () => {
    expect(taskStatusLabel({ status: 'in_progress', endDate: '2020-01-01' }, '2026-11-02')).toBe('Late');
    expect(taskStatusLabel({ status: 'completed', endDate: '2020-01-01' }, '2026-11-02')).toBe('Completed');
  });
});
