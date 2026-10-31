import { describe, it, expect } from 'vitest';
import { reviewSchedule, RULES_VERSION, type ReviewInput, type ReviewTask, type PeriodRuleInput } from '../../services/scheduleReview/rules';
import { periodLimit, periodWindow, describeLimit } from '../../services/scheduleReview/reportingPeriod';
import { weekdaysOnly, type IsWorking } from '../../utils/workingDays';

/** R42 "Tasks longer than one reporting period" and the limit it reads from the project calendar */

let seq = 0;
function task(over: Partial<ReviewTask> & { name: string }): ReviewTask {
  seq++;
  return { id: over.id ?? `t${seq}`, status: 'pending', dependencies: [], sortOrder: seq, updatedAt: '2026-10-30T00:00:00Z', ...over };
}
const WEEK: PeriodRuleInput = { limitDays: 5, limitHours: 37.5, periodLabel: '1 week', exceptionTaskIds: [] };

function run(tasks: ReviewTask[], periodRule: PeriodRuleInput | null | undefined = WEEK) {
  const input: ReviewInput = {
    schedule: { id: 's1', startDate: '2026-11-02', endDate: '2027-03-01' },
    project: { startDate: '2026-11-02', endDate: '2027-03-01' },
    tasks, resources: [], baselineCount: 1, floatByTask: null, overAllocations: null,
    today: new Date('2026-10-30T12:00:00Z'), periodRule,
  };
  return reviewSchedule(input).findings.filter(f => f.ruleId === 'R42');
}

// Mon 2 Nov to Tue 17 Nov 2026 = 12 working days
const long = (over: Partial<ReviewTask> = {}) => task({ name: 'Build login screens', startDate: '2026-11-02', endDate: '2026-11-17', estimatedDays: 12, ...over });

describe('R42 - tasks longer than one reporting period', () => {
  it('flags a task whose duration is over the limit, and says why', () => {
    const f = run([long({ id: 'a' })]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'medium', taskIds: ['a'] });
    expect(f[0].message).toContain('12 working days');
    expect(f[0].message).toContain('allows 5 working days');
    expect(f[0].message).toContain('Split it by deliverable');
  });

  it('flags a short task whose planned effort is over the hours limit', () => {
    const f = run([task({ id: 'b', name: 'Data migration', startDate: '2026-11-02', endDate: '2026-11-04', estimatedDays: 3, workHours: 62 })]);
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('62 hours');
    expect(f[0].message).toContain('37.5 hours');
    expect(f[0].message).not.toContain('it runs');
  });

  it('reads the effort from the hours planned on assignments when Work Hours is empty', () => {
    const f = run([task({ id: 'b', name: 'Data migration', startDate: '2026-11-02', endDate: '2026-11-04', assignments: [{ resourceId: 'r1', hoursPlanned: 50 }, { resourceId: 'r2', hoursPlanned: 50 }] })]);
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain('100 hours for 2 people (50 each)');
    expect(f[0].message).not.toContain('Add people');
  });

  it('shares the effort between the people booked: two people at 37.5 hours each fit a 37.5 hour week', () => {
    const two = [{ resourceId: 'r1', hoursPlanned: 37.5 }, { resourceId: 'r2', hoursPlanned: 37.5 }];
    expect(run([task({ name: 'Shared', startDate: '2026-11-02', endDate: '2026-11-06', assignments: two })])).toHaveLength(0);
    expect(run([task({ name: 'Shared by Work Hours', startDate: '2026-11-02', endDate: '2026-11-06', workHours: 75, assignments: two })])).toHaveLength(0);
    expect(run([task({ name: 'One person', startDate: '2026-11-02', endDate: '2026-11-06', workHours: 75, assignments: [two[0]] })])).toHaveLength(1);
  });

  it('says both reasons when duration and effort are over', () => {
    const f = run([long({ workHours: 100 })]);
    expect(f[0].message).toContain('12 working days');
    expect(f[0].message).toContain('100 hours');
  });

  it('leaves a task exactly at the limit alone', () => {
    expect(run([task({ name: 'Exactly a week', startDate: '2026-11-02', endDate: '2026-11-06', workHours: 37.5 })])).toHaveLength(0);
  });

  it('counts working days, not calendar days (a weekend does not lengthen a task)', () => {
    expect(run([task({ name: 'Fri to Fri', startDate: '2026-11-06', endDate: '2026-11-13' })])).toHaveLength(1); // 6 working days
    expect(run([task({ name: 'Mon to Fri', startDate: '2026-11-02', endDate: '2026-11-06' })])).toHaveLength(0);
  });

  it('never checks phases, milestones, zero-length rows, finished tasks, recurring or level-of-effort work', () => {
    const phase = long({ id: 'phase', name: 'Phase 1', isSummary: true });
    const child = task({ id: 'kid', name: 'Child in phase', parentTaskId: 'phase', startDate: '2026-11-02', endDate: '2026-11-04' });
    const out = run([
      phase, child,
      long({ name: 'Gate 1', isMilestone: true }),
      task({ name: 'Zero length', startDate: '2026-11-02', endDate: '2026-11-02', estimatedDays: 0 }),
      long({ name: 'Finished long task', status: 'completed' }),
      long({ name: 'Weekly status report' }),
      long({ name: 'Standing task', recurrenceParentId: 'p' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('leaves out a task the PM marked Cannot be split', () => {
    const t = long({ id: 'keep' });
    expect(run([t], { ...WEEK, exceptionTaskIds: ['keep'] })).toHaveLength(0);
    expect(run([t, long({ id: 'other', name: 'Another long task' })], { ...WEEK, exceptionTaskIds: ['keep'] }).map(f => f.taskIds[0])).toEqual(['other']);
  });

  it('does nothing when the project has the rule switched off', () => {
    expect(run([long()], null)).toHaveLength(0);
    const noField = reviewSchedule({ schedule: { id: 's1' }, tasks: [long()], baselineCount: 1, today: new Date('2026-10-30T12:00:00Z') });
    expect(noField.findings.some(f => f.ruleId === 'R42')).toBe(false);
  });

  it('uses the limit it is given: 2 weeks (10 days) and 1 month (22 days)', () => {
    const t = long(); // 12 working days
    expect(run([t], { limitDays: 10, limitHours: 75, periodLabel: '2 weeks', exceptionTaskIds: [] })).toHaveLength(1);
    expect(run([t], { limitDays: 22, limitHours: 165, periodLabel: '1 month', exceptionTaskIds: [] })).toHaveLength(0);
  });

  it('lowers the score like any other warning, and only when it is on', () => {
    const tasks = [long(), task({ name: 'Short', startDate: '2026-11-02', endDate: '2026-11-03' })];
    const input = (periodRule: PeriodRuleInput | null): ReviewInput => ({
      schedule: { id: 's1' }, tasks, baselineCount: 1, today: new Date('2026-10-30T12:00:00Z'), periodRule,
    });
    expect(reviewSchedule(input(WEEK)).score).toBeLessThan(reviewSchedule(input(null)).score);
  });

  it('bumps the rules version', () => {
    expect(RULES_VERSION).toBe('1.12');
  });
});

describe('periodLimit - what one reporting period holds', () => {
  const MIDWEEK_HOLIDAY: IsWorking = d => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-11-04';

  it('a week is 5 working days and 37.5 hours on a 7.5 hour calendar', () => {
    const l = periodLimit('week', '2026-11-04', weekdaysOnly, 7.5);
    expect(l).toMatchObject({ start: '2026-11-02', end: '2026-11-08', workingDays: 5, hours: 37.5 });
    expect(describeLimit(l)).toBe('5 working days / 37.5 hours');
  });

  it('a holiday inside the period shortens it', () => {
    const l = periodLimit('week', '2026-11-04', MIDWEEK_HOLIDAY, 8);
    expect(l.workingDays).toBe(4);
    expect(l.hours).toBe(32);
    expect(describeLimit({ workingDays: 1, hours: 8 })).toBe('1 working day / 8 hours');
  });

  it('two weeks is the status date week and the next', () => {
    expect(periodWindow('two_weeks', '2026-11-04')).toEqual({ start: '2026-11-02', end: '2026-11-15' });
    expect(periodLimit('two_weeks', '2026-11-04', weekdaysOnly, 8).workingDays).toBe(10);
  });

  it('a month is the calendar month of the status date', () => {
    expect(periodWindow('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodLimit('month', '2026-11-04', weekdaysOnly, 8).workingDays).toBe(21); // Nov 2026
  });

  it('never goes below one working day', () => {
    expect(periodLimit('week', '2026-11-04', () => false, 8).workingDays).toBe(1);
  });
});
