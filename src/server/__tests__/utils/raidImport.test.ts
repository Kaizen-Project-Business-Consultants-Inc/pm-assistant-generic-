import { describe, it, expect } from 'vitest';
import { normalizeRaidStatus, parseLevel, severityFromScore, parseRegisterDate, describeWithRegisterDetails } from '../../utils/raidImport';

// Values taken from a real register (DBJ LMS RAID log, Sep 2026)
describe('normalizeRaidStatus', () => {
  it('maps register wording to each type\'s statuses', () => {
    expect(normalizeRaidStatus('action', 'Pending')).toBe('open');          // used to fail the row
    expect(normalizeRaidStatus('action', 'Complete')).toBe('completed');
    expect(normalizeRaidStatus('decision', 'Approved')).toBe('decided');    // used to become pending_decision
    expect(normalizeRaidStatus('decision', 'Superseded')).toBe('reversed');
    expect(normalizeRaidStatus('risk', 'In Mitigation')).toBe('mitigating');
    expect(normalizeRaidStatus('risk', 'Realised')).toBe('closed');
    expect(normalizeRaidStatus('assumption', 'Invalidated')).toBe('closed');
    expect(normalizeRaidStatus('assumption', 'Validated')).toBe('validated');
    expect(normalizeRaidStatus('issue', 'In Progress')).toBe('in_progress');
  });
  it('reads the first recognised word of a longer value', () => {
    expect(normalizeRaidStatus('risk', 'Closed - mitigated')).toBe('closed');
    expect(normalizeRaidStatus('action', 'Open (overdue)')).toBe('open');
  });
  it('null for wording it cannot place, so the row keeps the default instead of failing', () => {
    expect(normalizeRaidStatus('decision', 'Parked by steering committee')).toBeNull();
    expect(normalizeRaidStatus('risk', '')).toBeNull();
  });
});

describe('parseLevel / severityFromScore', () => {
  it('reads words and numbers on the 1–5 scale', () => {
    expect(parseLevel('High')).toBe(4);
    expect(parseLevel('Medium')).toBe(3);
    expect(parseLevel('Low')).toBe(2);
    expect(parseLevel('Very high')).toBe(5);
    expect(parseLevel('2')).toBe(2);
    expect(parseLevel('9')).toBeUndefined();
    expect(parseLevel('')).toBeUndefined();
  });
  it('derives severity from likelihood × impact', () => {
    expect(severityFromScore(3, 4)).toBe('high');     // Medium × High
    expect(severityFromScore(3, 3)).toBe('medium');
    expect(severityFromScore(2, 2)).toBe('low');
    expect(severityFromScore(5, 4)).toBe('critical');
    expect(severityFromScore(undefined, 4)).toBeUndefined();
  });
});

describe('parseRegisterDate', () => {
  it('reads the register\'s date styles', () => {
    expect(parseRegisterDate('21-Jul-2026')).toBe('2026-07-21');
    expect(parseRegisterDate('3-Sep-26')).toBe('2026-09-03');
    expect(parseRegisterDate('2026-08-15')).toBe('2026-08-15');
    expect(parseRegisterDate('Aug 15, 2026')).toBe('2026-08-15');
    expect(parseRegisterDate('46249')).toBe('2026-08-15');     // Excel serial
    expect(parseRegisterDate('15/08/2026')).toBe('2026-08-15'); // day first
    expect(parseRegisterDate('08/15/2026')).toBe('2026-08-15'); // only possible as month first
  });
  it('refuses text that is not a date instead of inventing one', () => {
    expect(parseRegisterDate('Post Action A-39')).toBeNull(); // new Date() made this 2039
    expect(parseRegisterDate('TBD')).toBeNull();
    expect(parseRegisterDate('31-Feb-2026')).toBeNull();
    expect(parseRegisterDate('')).toBeNull();
  });
});

describe('describeWithRegisterDetails', () => {
  it('keeps the register\'s extra columns under the description', () => {
    expect(describeWithRegisterDetails('Main text', [['Register ID', 'R-01'], ['Closure reason', ''], ['Updates / resolution', 'Escalate to PMO']]))
      .toBe('Main text\n\nFrom the register:\nRegister ID: R-01\nUpdates / resolution: Escalate to PMO');
    expect(describeWithRegisterDetails(undefined, [['Register ID', 'A-05']])).toBe('From the register:\nRegister ID: A-05');
    expect(describeWithRegisterDetails('Only text', [])).toBe('Only text');
  });
});
