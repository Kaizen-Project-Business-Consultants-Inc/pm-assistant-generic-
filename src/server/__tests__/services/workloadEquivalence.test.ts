import { describe, it, expect } from 'vitest';
import { hoursInWeek, bookedHoursByWeek } from '../../services/weeklyLoad';
import { type IsWorking, weekdaysOnly, mondayOf } from '../../utils/workingDays';

/**
 * The Workload Heatmap's hours per person per week were made faster on 2026-10-08 (each booking
 * now visits only the weeks it covers, `bookedHoursByWeek`). This checks the new way gives exactly
 * the same numbers as the old one — copied below as `oldWay` from ResourceService.computeWorkload /
 * computeGlobalWorkload before the change — on a range of generated plans.
 */

type Booking = { resourceId: string; scheduleId: string; startDate: string; endDate: string; hoursPerWeek: number };

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The service's week list: Monday of the earliest start to the latest end, at least 8 weeks */
function weeksFor(bookings: Booking[]): Date[] {
  let minDate = Infinity;
  let maxDate = -Infinity;
  for (const a of bookings) {
    minDate = Math.min(minDate, new Date(a.startDate).getTime());
    maxDate = Math.max(maxDate, new Date(a.endDate).getTime());
  }
  const startWeek = new Date(`${mondayOf(new Date(minDate).toISOString())}T00:00:00Z`);
  const weeks: Date[] = [];
  for (let t = startWeek.getTime(); t <= maxDate; t += WEEK_MS) weeks.push(new Date(t));
  while (weeks.length < 8) weeks.push(new Date(weeks[weeks.length - 1].getTime() + WEEK_MS));
  return weeks;
}

/** OLD algorithm (pre 2026-10-08): every person × every week × all that person's bookings */
function oldWay(people: string[], here: Booking[], elsewhere: Booking[], weeks: Date[], calOf: (id: string) => IsWorking) {
  const out: Record<string, Array<{ rawHere: number; rawElsewhere: number; thisProject: number; otherProjects: number; allocated: number }>> = {};
  for (const resId of people) {
    const resAssignments = here.filter((a) => a.resourceId === resId);
    const resElsewhere = elsewhere.filter((a) => a.resourceId === resId);
    out[resId] = [];
    for (const weekStart of weeks) {
      const wk = weekStart.toISOString().slice(0, 10);
      let thisProject = 0;
      for (const a of resAssignments) thisProject += hoursInWeek(a, wk, calOf(a.scheduleId));
      let otherProjects = 0;
      for (const a of resElsewhere) otherProjects += hoursInWeek(a, wk, calOf(a.scheduleId));
      const rawHere = thisProject;
      const rawElsewhere = otherProjects;
      thisProject = Math.round(thisProject * 10) / 10;
      otherProjects = Math.round(otherProjects * 10) / 10;
      const allocated = Math.round((thisProject + otherProjects) * 10) / 10;
      out[resId].push({ rawHere, rawElsewhere, thisProject, otherProjects, allocated });
    }
  }
  return out;
}

/** NEW algorithm, as ResourceService now does it */
function newWay(people: string[], here: Booking[], elsewhere: Booking[], weeks: Date[], calOf: (id: string) => IsWorking) {
  const weekKeys = weeks.map(w => w.toISOString().slice(0, 10));
  const hereByWeek = bookedHoursByWeek(here, weekKeys, calOf);
  const elsewhereByWeek = bookedHoursByWeek(elsewhere, weekKeys, calOf);
  const out: ReturnType<typeof oldWay> = {};
  for (const resId of people) {
    const h = hereByWeek.get(resId);
    const e = elsewhereByWeek.get(resId);
    out[resId] = weekKeys.map((_, i) => {
      const rawHere = h?.[i] ?? 0;
      const rawElsewhere = e?.[i] ?? 0;
      const thisProject = Math.round(rawHere * 10) / 10;
      const otherProjects = Math.round(rawElsewhere * 10) / 10;
      const allocated = Math.round((thisProject + otherProjects) * 10) / 10;
      return { rawHere, rawElsewhere, thisProject, otherProjects, allocated };
    });
  }
  return out;
}

/** Small deterministic random generator so a failure can be reproduced */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

// calendars: Mon–Fri; Mon–Fri with holidays; a six-day week; a plan that works every day
const holidays = new Set(['2026-10-12', '2026-12-25', '2026-12-28', '2027-01-01', '2027-04-02', '2027-05-24']);
const calendars: Record<string, IsWorking> = {
  s0: weekdaysOnly,
  s1: (d) => weekdaysOnly(d) && !holidays.has(d.toISOString().slice(0, 10)),
  s2: (d) => d.getUTCDay() !== 0,
  s3: () => true,
};
const calOf = (id: string) => calendars[id] ?? weekdaysOnly;

function makeBookings(seed: number, count: number, people: number, spanDays: number): Booking[] {
  const r = rng(seed);
  const base = Date.parse('2026-09-01T00:00:00Z');
  const hoursChoices = [0, 0.5, 4, 7.3, 8, 13.33, 16, 20, 33.3, 37.5, 40, 60];
  const out: Booking[] = [];
  for (let i = 0; i < count; i++) {
    const start = base + Math.floor(r() * spanDays) * DAY_MS;
    const kind = r();
    // mostly short/partial weeks, some long, some one-day, some ending before they start
    const len = kind < 0.1 ? 0 : kind < 0.15 ? -Math.ceil(r() * 3) : kind < 0.8 ? Math.floor(r() * 15) : Math.floor(r() * 200);
    const b: Booking = {
      resourceId: `r${Math.floor(r() * people)}`,
      scheduleId: `s${Math.floor(r() * 4)}`,
      startDate: ymd(start),
      endDate: ymd(start + len * DAY_MS),
      hoursPerWeek: hoursChoices[Math.floor(r() * hoursChoices.length)],
    };
    // some dates arrive with a time on them
    if (r() < 0.1) b.startDate = `${b.startDate}T00:00:00.000Z`;
    out.push(b);
  }
  // overlapping duplicates of a few bookings
  for (let i = 0; i < Math.min(5, out.length); i++) out.push({ ...out[i], hoursPerWeek: out[i].hoursPerWeek / 3 });
  return out;
}

describe('Workload Heatmap hours: the faster way gives exactly the old numbers (2026-10-08)', () => {
  const cases = [
    { name: 'small project, few people', seed: 1, here: 30, other: 20, people: 3, span: 60 },
    { name: 'weekend and holiday heavy, one person', seed: 7, here: 25, other: 0, people: 1, span: 120 },
    { name: 'large programme, many people', seed: 42, here: 600, other: 400, people: 25, span: 500 },
    { name: 'bookings elsewhere outside this project\'s weeks', seed: 99, here: 40, other: 200, people: 6, span: 700 },
    { name: 'one-week project', seed: 5, here: 4, other: 3, people: 2, span: 3 },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const here = makeBookings(c.seed, c.here, c.people, c.span);
      // elsewhere bookings may start well before / end well after the weeks shown
      const elsewhere = makeBookings(c.seed + 1000, c.other, c.people + 2, c.span * 2)
        .map(b => ({ ...b, scheduleId: `s${(Number(b.scheduleId.slice(1)) + 1) % 4}` }));
      const weeks = weeksFor(here);
      const people = [...new Set([...here, ...elsewhere].map(a => a.resourceId))];
      const before = oldWay(people, here, elsewhere, weeks, calOf);
      const after = newWay(people, here, elsewhere, weeks, calOf);
      expect(after).toEqual(before);
      // and bit-for-bit, not just close
      for (const p of people) {
        before[p].forEach((w, i) => {
          expect(Object.is(after[p][i].rawHere, w.rawHere)).toBe(true);
          expect(Object.is(after[p][i].rawElsewhere, w.rawElsewhere)).toBe(true);
        });
      }
      // the generated plan really exercises something
      expect(Object.values(before).flat().some(w => w.allocated > 0)).toBe(true);
    });
  }

  it('the global heatmap (all bookings, nothing elsewhere) matches too', () => {
    const all = makeBookings(2026, 800, 30, 400);
    const weeks = weeksFor(all);
    const people = [...new Set(all.map(a => a.resourceId))];
    expect(newWay(people, all, [], weeks, calOf)).toEqual(oldWay(people, all, [], weeks, calOf));
  });

  it('a person with no bookings in a list gets no entry (read as 0 every week)', () => {
    const weekKeys = ['2026-10-05', '2026-10-12'];
    const m = bookedHoursByWeek([{ resourceId: 'a', scheduleId: 's0', startDate: '2026-10-08', endDate: '2026-10-13', hoursPerWeek: 40 }], weekKeys, calOf);
    expect(m.get('a')).toEqual([16, 16]);
    expect(m.has('b')).toBe(false);
  });
});
