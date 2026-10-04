// West of UTC, where the bug showed (the e2e suite runs in Toronto time). Set before any Date is made.
process.env.TZ = 'America/Toronto';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessTaskRisk, buildTaskRiskMap } from '../../utils/taskRiskAssessment';

/**
 * A task's dates are calendar days ('YYYY-MM-DD'). Reading one with new Date() gives midnight UTC —
 * the evening before for anyone west of UTC — so a task due TODAY was "Late" (2026-10-04). Now the
 * comparison is in the user's own calendar day.
 */
describe('assessTaskRisk — calendar days, in the user\'s own day', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Tue 13 Oct 2026, 10:00 in Toronto (14:00 UTC)
    vi.setSystemTime(new Date('2026-10-13T14:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('runs west of UTC (sanity check of the test itself)', () => {
    expect(new Date().getTimezoneOffset()).toBe(240);
  });

  it('a task due today is not late', () => {
    expect(assessTaskRisk({ id: 't', status: 'pending', startDate: '2026-10-05', endDate: '2026-10-13', progressPercentage: 100 })).toBe('none');
  });

  it('a task due today with little done is at risk, not late', () => {
    expect(assessTaskRisk({ id: 't', status: 'in_progress', startDate: '2026-10-05', endDate: '2026-10-13', progressPercentage: 0 })).toBe('critical');
  });

  it('a task due yesterday is late', () => {
    expect(assessTaskRisk({ id: 't', status: 'pending', startDate: '2026-10-05', endDate: '2026-10-12' })).toBe('late');
  });

  it('a date sent with a time (ISO) still counts by its calendar day', () => {
    expect(assessTaskRisk({ id: 't', status: 'pending', startDate: '2026-10-05T00:00:00.000Z', endDate: '2026-10-13T00:00:00.000Z', progressPercentage: 100 })).toBe('none');
  });

  it('a task starting today has nothing expected of it yet', () => {
    expect(assessTaskRisk({ id: 't', status: 'pending', startDate: '2026-10-13', endDate: '2026-10-20', progressPercentage: 0 })).toBe('none');
  });

  it('finished, cancelled, or undated tasks are never at risk', () => {
    expect(assessTaskRisk({ id: 't', status: 'completed', startDate: '2026-10-01', endDate: '2026-10-02' })).toBe('none');
    expect(assessTaskRisk({ id: 't', status: 'cancelled', startDate: '2026-10-01', endDate: '2026-10-02' })).toBe('none');
    expect(assessTaskRisk({ id: 't', status: 'pending', endDate: '2026-10-02' })).toBe('none');
    expect(assessTaskRisk({ id: 't', status: 'pending', startDate: 'garbage', endDate: 'garbage' })).toBe('none');
  });

  it('late in the evening, still today: not late', () => {
    vi.setSystemTime(new Date('2026-10-14T03:30:00Z')); // 23:30 on the 13th in Toronto
    const map = buildTaskRiskMap([{ id: 'a', status: 'pending', startDate: '2026-10-05', endDate: '2026-10-13', progressPercentage: 100 }]);
    expect(map.get('a')).toBe('none');
  });
});
