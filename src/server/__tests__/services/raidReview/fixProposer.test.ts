import { describe, it, expect } from 'vitest';
import { reviewRaid, type RaidReviewItem } from '../../../services/raidReview/rules';
import { proposeFixes, referencedDueDate, normaliseRecordId, suggestDueDate } from '../../../services/raidReview/fixProposer';
import { weekdaysOnly } from '../../../utils/workingDays';

const TODAY = '2026-09-29'; // a Tuesday

function propose(items: RaidReviewItem[]) {
  const { findings } = reviewRaid({ items, today: TODAY, disabledRules: [] });
  return proposeFixes({ findings, items, today: TODAY, isWorking: weekdaysOnly });
}

const base = (over: Partial<RaidReviewItem> & { id: string; type: string }): RaidReviewItem => ({
  recordId: null, title: 'Something that could happen', status: 'open', ownerId: 'u1', dueDate: '2026-10-30',
  updatedAt: '2026-09-28 00:00:00', responseStrategy: 'mitigate', responsePlan: 'x', validationPlan: 'x',
  description: 'If x, y may happen', ...over,
});

describe('RAID Review fix proposer', () => {
  it('moves a risk that reads as a task to Actions, ticked by default', () => {
    const fixes = propose([base({ id: 'r10', recordId: 'R-010', type: 'risk', title: 'Provide the test data' })]);
    const f = fixes.find(x => x.kind === 'change_type')!;
    expect(f).toMatchObject({
      id: 'change_type:r10', itemId: 'r10', recordId: 'R-010', toType: 'action', confidence: 0.8, defaultChecked: true,
    });
    expect(f.text).toBe('Move R-010 "Provide the test data" to Actions');
  });

  it('asks for one owner for unowned or group-owned items (not ticked)', () => {
    const fixes = propose([
      base({ id: 'a1', recordId: 'A-001', type: 'action', ownerId: null }),
      base({ id: 'a2', recordId: 'A-002', type: 'action', ownerId: null, ownerName: 'DBJ (CRM)' }),
    ]);
    const owners = fixes.filter(f => f.kind === 'set_owner');
    expect(owners.map(f => f.id)).toEqual(['set_owner:a1', 'set_owner:a2']);
    expect(owners.every(f => !f.defaultChecked && f.input?.type === 'person')).toBe(true);
    expect(owners[1].reason).toContain('DBJ (CRM)');
  });

  it('suggests a response strategy of mitigate when a mitigation plan exists', () => {
    const fixes = propose([
      base({ id: 'r1', type: 'risk', severity: 'high', responseStrategy: null, mitigationPlan: 'Second vendor' }),
      base({ id: 'r2', type: 'risk', severity: 'critical', responseStrategy: null, mitigationPlan: null }),
    ]);
    const s = fixes.filter(f => f.kind === 'set_response_strategy');
    expect(s[0].input).toEqual({ type: 'strategy', suggested: 'mitigate' });
    expect(s[1].input).toEqual({ type: 'strategy' });
  });

  it('suggests a due date 10 working days from today for an action with none', () => {
    const fixes = propose([base({ id: 'a1', type: 'action', dueDate: null })]);
    const f = fixes.find(x => x.kind === 'set_due_date')!;
    expect(f.input).toEqual({ type: 'date', suggested: '2026-10-13' });
    expect(f.defaultChecked).toBe(false);
  });

  it('suggests 5 working days after the action the register says it follows', () => {
    const a39 = base({ id: 'a39', recordId: 'A-039', type: 'action', dueDate: '2026-10-09' }); // Friday
    const a40 = base({
      id: 'a40', recordId: 'A-040', type: 'action', dueDate: null,
      description: 'Post go-live check\n\nFrom the register:\nRegister ID: A-40\nDue date in the register: Post Action A-39',
    });
    expect(normaliseRecordId('A-39')).toBe(normaliseRecordId('A-039'));
    expect(referencedDueDate(a40, [a39, a40])).toBe('2026-10-09');
    expect(suggestDueDate(a40, [a39, a40], TODAY, weekdaysOnly)).toBe('2026-10-16');
    expect(propose([a39, a40]).find(f => f.id === 'set_due_date:a40')?.input?.suggested).toBe('2026-10-16');
  });

  it('only proposes due dates for actions (not overdue issues)', () => {
    const fixes = propose([base({ id: 'i1', type: 'issue', dueDate: '2026-08-01', updatedAt: '2026-08-01 00:00:00' })]);
    expect(fixes.some(f => f.kind === 'set_due_date')).toBe(false);
  });

  it('gives one fix per item and kind even when two rules point at it', () => {
    const fixes = propose([base({ id: 'a1', type: 'action', ownerId: null, dueDate: '2026-08-01', updatedAt: '2026-08-01 00:00:00' })]);
    expect(fixes.filter(f => f.id === 'set_due_date:a1')).toHaveLength(1);
    expect(fixes.filter(f => f.id === 'set_owner:a1')).toHaveLength(1);
  });
});
