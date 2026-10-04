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
  it("the server's answer wins when the task carries one (it sees hours bookings and real resources)", () => {
    // Only an hours booking: the screen alone can't see it, the server says locked
    expect(progressFromHours({ ...base, progressFromHours: true })).toBe(true);
    // "Assigned to" holds an old name that is no resource: the server says not locked
    expect(progressFromHours({ ...base, assignedTo: 'Old Name', progressFromHours: false })).toBe(false);
    // No answer (an unsaved form): the screen's own rule
    expect(progressFromHours({ ...base, assignedTo: 'r1', progressFromHours: undefined })).toBe(true);
    expect(progressFromHours({ ...base, assignedTo: 'r1', progressFromHours: null })).toBe(true);
  });
});
