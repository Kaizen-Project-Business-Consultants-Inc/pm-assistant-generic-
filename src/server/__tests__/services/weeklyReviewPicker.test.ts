import { describe, it, expect } from 'vitest';
import { pickWeekly, MAX_DECISIONS, type WeeklyFacts } from '../../services/weeklyReview/picker';

const base = (over: Partial<WeeklyFacts> = {}): WeeklyFacts => ({
  asOf: '2026-10-09',
  delays: [],
  overloads: [],
  evm: { CPI: 1.02, SPI: 1, BAC: 100_000, EAC: 98_000, VAC: 2_000 },
  currency: 'USD',
  plans: [{ scheduleId: 's1', name: 'Main plan', score: 86, previousScore: 82, critical: 0, staleTasks: 0 }],
  raid: { open: 5, unhandled: [], overdue: [] },
  changeRequests: [],
  timesheetsWaiting: [],
  taskCount: 40,
  ...over,
});

const delay = (id: string, days: number, critical = true) =>
  ({ taskId: id, taskName: `Task ${id}`, scheduleId: 's1', delayDays: days, isOnCriticalPath: critical, currentProgress: 40 });

describe('weekly review picker', () => {
  it('a healthy project: no decisions, green, and says what is fine', () => {
    const p = pickWeekly(base());
    expect(p.items).toEqual([]);
    expect(p.rag).toBe('green');
    expect(p.fine.map(f => f.label)).toEqual(expect.arrayContaining(['On track', 'On budget', 'Plan quality 86', 'Risks under control', 'Nobody overloaded']));
    expect(p.fine.find(f => f.label === 'Plan quality 86')!.detail).toBe('up 4 since last check');
    expect(p.uncertainty).toEqual([]);
  });

  it('a critical-path delay comes first, red, and sets the status colour', () => {
    const p = pickWeekly(base({
      delays: [delay('a', 8, false), delay('b', 5)],
      overloads: [{ resourceId: 'r1', resourceName: 'Peter', weeks: [{ weekStart: '2026-10-12', allocated: 48, capacity: 40 }] }],
    }));
    expect(p.items.map(i => i.kind)).toEqual(['finish_at_risk', 'overloaded', 'task_late']);
    expect(p.items[0].level).toBe('red');
    expect(p.items[0].refs).toEqual({ taskId: 'b', scheduleId: 's1' });
    expect(p.rag).toBe('red');
    expect(p.ragReason).toBe('because of the finish date');
    expect(p.fine.map(f => f.label)).not.toContain('On track');
  });

  it('small slips off the critical path are not a decision', () => {
    const p = pickWeekly(base({ delays: [delay('a', 3, false)] }));
    expect(p.items).toEqual([]);
    expect(p.fine.find(f => f.label === 'On track')!.detail).toMatch(/little behind/);
  });

  it(`never lists more than ${MAX_DECISIONS} decisions, and counts the rest`, () => {
    const p = pickWeekly(base({ delays: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, n) => delay(id, n + 3)) }));
    expect(p.items).toHaveLength(MAX_DECISIONS);
    expect(p.moreFound).toBe(2);
    // biggest delay first
    expect(p.items[0].measure).toBe(9);
  });

  it('cost over budget: CPI under 0.9 is a decision, under 0.8 is red', () => {
    const amber = pickWeekly(base({ evm: { CPI: 0.85, SPI: 1, BAC: 100_000, EAC: 117_647, VAC: -17_647 } }));
    expect(amber.items[0]).toMatchObject({ kind: 'over_budget', level: 'amber', measure: 15 });
    expect(amber.items[0].headline).toContain('$17,647 over budget');
    const red = pickWeekly(base({ evm: { CPI: 0.7, SPI: 1, BAC: 100_000, EAC: 142_857, VAC: -42_857 } }));
    expect(red.items[0].level).toBe('red');
    expect(red.fine.map(f => f.label)).not.toContain('On budget');
  });

  it('no budget: cost is not judged, and the review says so', () => {
    const p = pickWeekly(base({ evm: null }));
    expect(p.items).toEqual([]);
    expect(p.uncertainty).toContain('No budget is set, so cost was not checked.');
  });

  it('plan quality dropping 10+ points is a decision; a smaller drop is just noted', () => {
    const drop = pickWeekly(base({ plans: [{ scheduleId: 's1', name: 'Main plan', score: 70, previousScore: 84, critical: 0, staleTasks: 0 }] }));
    expect(drop.items[0]).toMatchObject({ kind: 'plan_quality', measure: 14 });
    const small = pickWeekly(base({ plans: [{ scheduleId: 's1', name: 'Main plan', score: 80, previousScore: 84, critical: 0, staleTasks: 0 }] }));
    expect(small.items).toEqual([]);
    expect(small.fine.find(f => f.label === 'Plan quality 80')!.detail).toBe('down 4 since last check');
  });

  it('RAID, change requests and timesheets each become one grouped item', () => {
    const p = pickWeekly(base({
      raid: { open: 6, unhandled: [{ id: 'r1', title: 'Vendor late', why: 'no owner' }], overdue: [{ id: 'r2', title: 'Sign-off', dueDate: '2026-10-01' }] },
      changeRequests: [{ id: 'c1', title: 'Add SSO', waitingDays: 9 }, { id: 'c2', title: 'New report', waitingDays: 2 }],
      timesheetsWaiting: [{ userName: 'Maria', weekStart: '2026-09-28' }, { userName: 'Maria', weekStart: '2026-10-05' }],
    }));
    expect(p.items.map(i => i.kind)).toEqual(['risks_unhandled', 'raid_overdue', 'cr_waiting', 'timesheets_waiting']);
    expect(p.items[2].headline).toMatch(/^1 change request has waited/);
    expect(p.items[3].facts).toEqual(['Maria']);
    expect(p.uncertainty.some(u => /waiting for approval/.test(u))).toBe(true);
  });

  it('a dismissed problem stays quiet unless it gets worse', () => {
    const facts = base({ delays: [delay('b', 5)] });
    const quiet = pickWeekly(facts, [{ key: 'delay:b', measure: 5, at: '2026-10-02' }]);
    expect(quiet.items).toEqual([]);
    expect(quiet.quietened).toBe(1);
    const worse = pickWeekly(base({ delays: [delay('b', 7)] }), [{ key: 'delay:b', measure: 5, at: '2026-10-02' }]);
    expect(worse.items).toHaveLength(1);
    const longAgo = pickWeekly(facts, [{ key: 'delay:b', measure: 5, at: '2026-08-01' }]);
    expect(longAgo.items).toHaveLength(1);
  });

  it('a dismissed item still counts towards the status colour', () => {
    const p = pickWeekly(base({ delays: [delay('b', 5)] }), [{ key: 'delay:b', measure: 5, at: '2026-10-02' }]);
    expect(p.rag).toBe('red');
  });

  it('stale tasks and an empty plan are called out as uncertainty', () => {
    const stale = pickWeekly(base({ plans: [{ scheduleId: 's1', name: 'Main plan', score: 86, previousScore: null, critical: 0, staleTasks: 2 }] }));
    expect(stale.uncertainty[0]).toMatch(/^2 tasks in progress haven't been updated/);
    const empty = pickWeekly(base({ taskCount: 0, plans: [], evm: null, raid: { open: 0, unhandled: [], overdue: [] } }));
    expect(empty.fine).toEqual([]);
    expect(empty.uncertainty).toContain('The project has no tasks yet, so the schedule and workload were not checked.');
  });
});
