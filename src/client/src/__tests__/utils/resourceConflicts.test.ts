import { describe, it, expect } from 'vitest';
import { findResourceConflicts, type WorkloadRow } from '../../utils/resourceConflicts';

const workload: WorkloadRow[] = [
  { resourceId: 'anna', resourceName: 'Anna Lee', weeks: [
    { weekStart: '2026-10-05', utilization: 90 },
    { weekStart: '2026-10-12', utilization: 140 },
    { weekStart: '2026-10-19', utilization: 120 },
  ] },
  { resourceId: 'ben', resourceName: 'Ben Ode', weeks: [{ weekStart: '2026-10-12', utilization: 100 }] },
];

describe('findResourceConflicts (Gantt Conflicts = Workload Heatmap numbers)', () => {
  it('flags a task in a week its person is over 100%, naming the worst week', () => {
    const out = findResourceConflicts([
      { id: 't1', startDate: '2026-10-14', endDate: '2026-10-21', assignments: [{ resourceId: 'anna' }] },
    ], workload, new Set());
    expect(out.get('t1')).toEqual([expect.stringMatching(/^Anna Lee 140% \(week of .*12.*\) \+1 more week$/)]);
  });

  it('never flags finished or cancelled work (it takes nobody\'s time any more)', () => {
    const out = findResourceConflicts([
      { id: 'done', status: 'completed', startDate: '2026-10-14', endDate: '2026-10-21', assignments: [{ resourceId: 'anna' }] },
      { id: 'off', status: 'cancelled', startDate: '2026-10-14', endDate: '2026-10-21', assignedTo: 'anna' },
      { id: 'open', status: 'in_progress', startDate: '2026-10-14', endDate: '2026-10-21', assignedTo: 'anna' },
    ], workload, new Set());
    expect([...out.keys()]).toEqual(['open']);
  });

  it('counts "Assigned to" as well as the task\'s people', () => {
    const out = findResourceConflicts([{ id: 't2', startDate: '2026-10-19', endDate: '2026-10-20', assignedTo: 'anna' }], workload, new Set());
    expect(out.get('t2')?.[0]).toMatch(/^Anna Lee 120%/);
  });

  it('does not flag: exactly 100%, weeks outside the task, headings, milestones, undated tasks', () => {
    const out = findResourceConflicts([
      { id: 'ok100', startDate: '2026-10-12', endDate: '2026-10-16', assignments: [{ resourceId: 'ben' }] },
      { id: 'before', startDate: '2026-10-05', endDate: '2026-10-09', assignments: [{ resourceId: 'anna' }] },
      { id: 'head', startDate: '2026-10-12', endDate: '2026-10-16', assignedTo: 'anna' },
      { id: 'ms', startDate: '2026-10-14', endDate: '2026-10-14', isMilestone: true, assignedTo: 'anna' },
      { id: 'nodate', assignedTo: 'anna' },
    ], workload, new Set(['head']));
    expect([...out.keys()]).toEqual([]);
  });

  it('a week runs Monday to Sunday: a task starting on its Sunday or ending on its Monday still touches it', () => {
    const out = findResourceConflicts([
      { id: 'sun', startDate: '2026-10-18', endDate: '2026-10-18', assignedTo: 'anna' },
      { id: 'mon', startDate: '2026-10-08', endDate: '2026-10-12', assignedTo: 'anna' },
      { id: 'after', startDate: '2026-10-26', endDate: '2026-10-30', assignedTo: 'anna' },
    ], workload, new Set());
    expect(out.get('sun')?.[0]).toMatch(/^Anna Lee 140%/);
    expect(out.get('mon')?.[0]).toMatch(/^Anna Lee 140%/);
    expect(out.has('after')).toBe(false);
  });

  it('week label is the same text as toLocaleDateString (one shared formatter), also for timestamped weeks', () => {
    const expected = new Date('2026-10-12T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const stamped: WorkloadRow[] = [{ resourceId: 'cy', resourceName: 'Cy', weeks: [{ weekStart: '2026-10-12T00:00:00.000Z', utilization: 150 }] }];
    const out = findResourceConflicts([
      { id: 'a', startDate: '2026-10-13', endDate: '2026-10-13', assignedTo: 'cy' },
      { id: 'b', startDate: '2026-10-14T00:00:00Z', endDate: '2026-10-15T00:00:00Z', assignedTo: 'cy' },
    ], stamped, new Set());
    expect(out.get('a')).toEqual([`Cy 150% (week of ${expected})`]);
    expect(out.get('b')).toEqual([`Cy 150% (week of ${expected})`]);
  });
});
