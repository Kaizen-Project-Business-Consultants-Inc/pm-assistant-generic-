import { describe, it, expect } from 'vitest';
import { attentionReason } from '../../utils/raidAttention';

const T = '2026-10-15';

/** U20: "Needs attention" across all RAID types, with the reason in plain words */
describe('attentionReason', () => {
  it('risks: triggered, or high with no response plan', () => {
    expect(attentionReason({ type: 'risk', status: 'open', severity: 'high' }, T)).toBe('High risk with no response plan');
    expect(attentionReason({ type: 'risk', status: 'open', severity: 'high', mitigationPlan: 'Second vendor' }, T)).toBeNull();
    expect(attentionReason({ type: 'risk', status: 'open', severity: 'critical', responseStrategy: 'accept' }, T)).toBeNull();
    expect(attentionReason({ type: 'risk', status: 'monitoring', severity: 'low', triggered: true }, T)).toMatch(/Triggered/);
  });
  it('issues: open high or critical', () => {
    expect(attentionReason({ type: 'issue', status: 'in_progress', severity: 'critical' }, T)).toBe('Open critical issue');
    expect(attentionReason({ type: 'issue', status: 'open', severity: 'medium' }, T)).toBeNull();
  });
  it('actions: overdue', () => {
    expect(attentionReason({ type: 'action', status: 'open', dueDate: '2026-10-14' }, T)).toBe('Overdue');
    expect(attentionReason({ type: 'action', status: 'open', dueDate: '2026-10-15' }, T)).toBeNull();
  });
  it('decisions waiting, assumptions to confirm, dependencies at risk', () => {
    expect(attentionReason({ type: 'decision', status: 'pending_decision' }, T)).toBe('Waiting for a decision');
    expect(attentionReason({ type: 'assumption', status: 'open', dueDate: '2026-10-20' }, T)).toBe('Confirm within a week');
    expect(attentionReason({ type: 'assumption', status: 'open', dueDate: '2026-11-20' }, T)).toBeNull();
    expect(attentionReason({ type: 'assumption', status: 'unverified' }, T)).toBe('Not confirmed yet');
    expect(attentionReason({ type: 'dependency', status: 'at_risk' }, T)).toBe('At risk');
    expect(attentionReason({ type: 'dependency', status: 'open', dueDate: '2026-10-01' }, T)).toBe('Past its needed-by date');
  });
  it('finished items never need attention', () => {
    for (const status of ['closed', 'mitigated', 'resolved', 'completed', 'complete', 'decided', 'validated', 'deferred']) {
      expect(attentionReason({ type: 'risk', status, severity: 'critical', triggered: true }, T)).toBeNull();
    }
  });
});
