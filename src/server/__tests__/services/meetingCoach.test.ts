import { describe, it, expect } from 'vitest';
import { resolveOwner, workingDue, buildScorecard } from '../../services/meetingCoach';
import { weekdaysOnly } from '../../utils/workingDays';

const members = [
  { userId: 'u-tr', name: 'Tom Reyes' },
  { userId: 'u-to', name: 'Tom Okafor' },
  { userId: 'u-dp', name: 'Dev Patel' },
];

describe('Meeting Coach — who owns it', () => {
  it('a full name is that project member', () => {
    expect(resolveOwner('Tom Reyes', members)).toEqual({ ownerUserId: 'u-tr', ownerName: 'Tom Reyes' });
    expect(resolveOwner('dev patel', members)).toEqual({ ownerUserId: 'u-dp', ownerName: 'Dev Patel' });
  });

  it('a first name that fits one person is that person', () => {
    expect(resolveOwner('Dev', members)).toEqual({ ownerUserId: 'u-dp', ownerName: 'Dev Patel' });
  });

  it('"Tom" with two Toms: the PM chooses', () => {
    expect(resolveOwner('Tom', members).ownerChoices?.map(c => c.userId)).toEqual(['u-tr', 'u-to']);
    expect(resolveOwner('Tom', members).ownerUserId).toBeUndefined();
  });

  it('someone not on the project is kept as a name only; nobody → no owner', () => {
    expect(resolveOwner('Vendor Joe', members)).toEqual({ ownerName: 'Vendor Joe' });
    expect(resolveOwner('J. Lindqvist (not a project member)', members)).toEqual({ ownerName: 'J. Lindqvist' });
    expect(resolveOwner('', members)).toEqual({});
    expect(resolveOwner('Unassigned', members)).toEqual({});
    expect(resolveOwner(undefined, members)).toEqual({});
  });
});

describe('Meeting Coach — by when', () => {
  it('a weekday stays; a weekend moves to the next working day', () => {
    expect(workingDue('2026-10-02', weekdaysOnly)).toBe('2026-10-02'); // Friday
    expect(workingDue('2026-10-03', weekdaysOnly)).toBe('2026-10-05'); // Saturday → Monday
  });

  it('a project day off counts too', () => {
    const offFriday = (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-02';
    expect(workingDue('2026-10-02', offFriday)).toBe('2026-10-05');
  });

  it('no date said, or not a date → no due date (never invented)', () => {
    expect(workingDue(undefined, weekdaysOnly)).toBeUndefined();
    expect(workingDue('Friday', weekdaysOnly)).toBeUndefined();
    expect(workingDue('2026-13-45', weekdaysOnly)).toBeUndefined();
  });
});

describe('Meeting Coach — scorecard', () => {
  const meeting = {
    actionItems: [
      { calledOut: true, description: 'Order the test devices', ownerUserId: 'u-tr', ownerName: 'Tom Reyes', dueDate: '2026-10-02' },
      { calledOut: true, description: 'Book the UAT room', ownerName: 'Tom Okafor' },
    ],
    risks: [{ calledOut: true, description: 'Vendor may slip the API release' }, { calledOut: false, description: 'Key tester on leave', ownerName: 'Dev Patel' }],
    issues: [{ calledOut: false, description: 'Test server keeps timing out' }],
    decisions: [{ calledOut: true, decision: 'Go live on 9 November' }],
    dependencies: [{ calledOut: true, description: 'Bureau API keys first' }],
  };

  it('counts called out vs. spotted, and the gaps', () => {
    const s = buildScorecard(meeting);
    expect(s.calledOut).toBe(5);
    expect(s.aiOnly).toBe(2);
    expect(s.actions).toEqual({ total: 2, withOwnerAndDate: 1 });
    expect(s.risks).toEqual({ total: 2, withOwner: 1 });
  });

  it('tips say what to do next time, about the meeting not the person', () => {
    const tips = buildScorecard(meeting).tips;
    expect(tips).toContain('"Book the UAT room" had no date. Ask "by when?" before moving on.');
    expect(tips).toContain('Risk "Vendor may slip the API release" has nobody watching it. Ask "who\'s watching it?"');
    expect(tips).toContain('"Test server keeps timing out" was discussed but never called out as an issue.');
    expect(tips.join(' ')).not.toMatch(/Tom|Dev/);
  });

  it('trend: this meeting + the 3 before, against the 4 before that', () => {
    const prev = [
      { calledOut: 3, aiOnly: 1 }, { calledOut: 2, aiOnly: 2 }, { calledOut: 1, aiOnly: 3 },
      { calledOut: 1, aiOnly: 4 }, { calledOut: 0, aiOnly: 5 }, { calledOut: 1, aiOnly: 4 }, { calledOut: 2, aiOnly: 3 },
    ];
    const t = buildScorecard(meeting, prev).trend;
    expect(t.meetings).toBe(4);
    expect(t.recentShare).toBeCloseTo(11 / 19);
    expect(t.previousShare).toBeCloseTo(4 / 20);
    expect(buildScorecard(meeting).trend).toEqual({ recentShare: 5 / 7, meetings: 1, previousShare: null });
  });

  it('an empty meeting does not divide by zero', () => {
    const s = buildScorecard({ actionItems: [], risks: [], issues: [], decisions: [], dependencies: [] });
    expect(s.trend.recentShare).toBeNull();
    expect(s.tips).toEqual([]);
  });
});
