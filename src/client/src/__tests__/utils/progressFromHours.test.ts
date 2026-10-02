import { describe, it, expect } from 'vitest';
import { progressFromHours } from '../../utils/progressFromHours';

describe('progressFromHours — which tasks get a calculated % (no typing)', () => {
  const base = { startDate: '2026-10-12', endDate: '2026-10-16', isMilestone: false, isSummary: false };
  it('a dated task with someone on it: yes', () => {
    expect(progressFromHours({ ...base, assignedTo: 'r1' })).toBe(true);
    expect(progressFromHours({ ...base, assignments: [{ resourceId: 'r2' }] })).toBe(true);
  });
  it('nobody planned, a milestone, a heading, or no dates: no — the PM types the %', () => {
    expect(progressFromHours({ ...base })).toBe(false);
    expect(progressFromHours({ ...base, assignedTo: 'r1', isMilestone: true })).toBe(false);
    expect(progressFromHours({ ...base, assignedTo: 'r1', isSummary: true })).toBe(false);
    expect(progressFromHours({ ...base, assignedTo: 'r1', startDate: null })).toBe(false);
    expect(progressFromHours(null)).toBe(false);
  });
});
