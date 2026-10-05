import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guard (2026-10-05, audit high "workload wrong under load / slow"): workload read EVERY booking in
 * the company, then two hour-queries per person one at a time, and fired every plan-calendar read
 * at once (a failed read silently became Mon–Fri). Keep it batched.
 */
const svc = readFileSync(join(__dirname, '..', '..', 'services', 'ResourceService.ts'), 'utf-8');
const between = (from: string, to: string) => svc.slice(svc.indexOf(from), svc.indexOf(to));

describe('workload stays batched', () => {
  const project = between('async computeWorkload(', 'async computeUnfilledDemand(');
  const global = between('async computeGlobalWorkload(', 'async computeUtilizationHistory(');

  it("project workload reads only its people's other bookings", () => {
    expect(project).toMatch(/findEffectiveAssignments\(\{ from: firstDay, to: lastDay, resourceIds: \[\.\.\.people\] \}\)/);
  });

  it('hours for everyone come from one query, not per person', () => {
    for (const block of [project, global]) {
      expect(block).toMatch(/sumHoursByUsersAndWeekRange\(/);
      expect(block).not.toMatch(/sumHoursByUserAndWeekRange\(|sumHoursByRateTypeAndWeekRange\(/);
    }
  });

  it('plan calendars are read a few at a time', () => {
    const load = readFileSync(join(__dirname, '..', '..', 'services', 'weeklyLoad.ts'), 'utf-8');
    expect(load).toMatch(/i \+= CALENDAR_LOOKUPS_AT_ONCE/);
  });
});
