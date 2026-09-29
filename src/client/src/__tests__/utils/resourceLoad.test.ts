import { describe, it, expect } from 'vitest';
import { describeOverload } from '../../utils/resourceLoad';

describe('describeOverload (warning while allocating)', () => {
  it('names the worst week, what else they are on, and how many more weeks are over', () => {
    const text = describeOverload({
      resourceId: 'm', resourceName: 'Michael Annamunthodo',
      overWeeks: [
        { weekStart: '2026-10-12', utilization: 150, hours: 60, capacity: 40, alsoOn: ['Kick-off workshops', 'Weekly status report'] },
        { weekStart: '2026-10-19', utilization: 250, hours: 100, capacity: 40, alsoOn: ['Kick-off workshops', 'Weekly status report', 'Story register', 'Work on another project'] },
        { weekStart: '2026-10-26', utilization: 110, hours: 44, capacity: 40, alsoOn: [] },
      ],
    });
    expect(text).toBe('Michael would be at 250% in the week of Oct 19 (also on: Kick-off workshops, Weekly status report, Story register +1 more) +2 more weeks over 100%.');
  });

  it('says nothing when nobody goes over 100%', () => {
    expect(describeOverload({ resourceId: 'm', resourceName: 'M', overWeeks: [] })).toBeNull();
    expect(describeOverload(undefined)).toBeNull();
  });

  it('one week, nothing else booked', () => {
    expect(describeOverload({ resourceId: 'a', resourceName: 'Anna', overWeeks: [{ weekStart: '2026-12-21', utilization: 125, hours: 20, capacity: 16, alsoOn: [] }] }))
      .toBe('Anna would be at 125% in the week of Dec 21.');
  });
});
