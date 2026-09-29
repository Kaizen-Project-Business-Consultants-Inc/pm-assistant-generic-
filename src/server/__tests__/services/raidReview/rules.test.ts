import { describe, it, expect } from 'vitest';
import {
  reviewRaid, isGroupOwnerName, looksLikeWrongType, isCauseEventEffect, jaccard, titleWords,
  RULES_VERSION, type RaidReviewItem,
} from '../../../services/raidReview/rules';

const TODAY = '2026-09-29';
let n = 0;
/** A clean, well-formed item of each type — no rule fires on these */
function item(over: Partial<RaidReviewItem> & { type: string }): RaidReviewItem {
  n++;
  const base: RaidReviewItem = {
    id: `id-${n}`, recordId: `X-${n}`, title: `Well formed item number ${n} alpha${n}`, status: 'open',
    description: 'If the vendor is late, delivery may slip, resulting in a delay.',
    severity: 'medium', ownerId: 'u1', dueDate: '2026-10-10', updatedAt: '2026-09-28 10:00:00',
    responseStrategy: 'mitigate', responsePlan: 'plan', validationPlan: 'check', rationale: 'why',
    decisionDate: '2026-09-01', decidedBy: 'u1',
  };
  return { ...base, ...over };
}
const run = (items: RaidReviewItem[], disabledRules: string[] = []) => reviewRaid({ items, today: TODAY, disabledRules });
const fired = (items: RaidReviewItem[], rule: string) => run(items).findings.find(f => f.ruleId === rule);

describe('RAID Review rules', () => {
  it('a clean log scores 100 with no findings', () => {
    const r = run([item({ type: 'risk', title: 'Vendor may deliver late' }), item({ type: 'action' }), item({ type: 'issue' })]);
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.rulesVersion).toBe(RULES_VERSION);
    expect(r.itemsChecked).toBe(3);
  });

  it('RR01 open high/critical risk with no response strategy', () => {
    expect(fired([item({ type: 'risk', severity: 'high', responseStrategy: null })], 'RR01')?.items).toHaveLength(1);
    expect(fired([item({ type: 'risk', severity: 'critical', responseStrategy: null })], 'RR01')).toBeTruthy();
    expect(fired([item({ type: 'risk', severity: 'medium', responseStrategy: null })], 'RR01')).toBeUndefined();
    expect(fired([item({ type: 'risk', severity: 'high', responseStrategy: null, status: 'closed' })], 'RR01')).toBeUndefined();
    expect(fired([item({ type: 'risk', severity: 'high', responseStrategy: 'accept' })], 'RR01')).toBeUndefined();
  });

  it('RR02 open action with no due date', () => {
    expect(fired([item({ type: 'action', dueDate: null })], 'RR02')?.severity).toBe('high');
    expect(fired([item({ type: 'action', dueDate: null, status: 'completed', resolvedAt: '2026-09-01' })], 'RR02')).toBeUndefined();
    expect(fired([item({ type: 'issue', dueDate: null })], 'RR02')).toBeUndefined();
  });

  it('RR03 open item with no owner', () => {
    expect(fired([item({ type: 'issue', ownerId: null, ownerName: null, ownerResourceId: null })], 'RR03')).toBeTruthy();
    expect(fired([item({ type: 'issue', ownerId: null, ownerResourceId: 'res1' })], 'RR03')).toBeUndefined();
    expect(fired([item({ type: 'issue', ownerId: null, ownerName: 'Marsha Turner' })], 'RR03')).toBeUndefined();
  });

  it('RR04 overdue and not updated for over 14 days', () => {
    expect(fired([item({ type: 'action', dueDate: '2026-09-01', updatedAt: '2026-09-10 09:00:00' })], 'RR04')).toBeTruthy();
    expect(fired([item({ type: 'action', dueDate: '2026-09-01', updatedAt: '2026-09-20 09:00:00' })], 'RR04')).toBeUndefined();
    expect(fired([item({ type: 'action', dueDate: '2026-10-01', updatedAt: '2026-08-01 09:00:00' })], 'RR04')).toBeUndefined();
    expect(fired([item({ type: 'action', dueDate: '2026-09-29', updatedAt: '2026-08-01 09:00:00' })], 'RR04')).toBeUndefined(); // due today is not late
  });

  it('RR05 owner is a team, organisation or several people', () => {
    expect(isGroupOwnerName('DBJ')).toBe(true);
    expect(isGroupOwnerName('DBJ (CRM)')).toBe(true);
    expect(isGroupOwnerName('Michel Spence / Claudia Andrews')).toBe(true);
    expect(isGroupOwnerName('Finance and IT')).toBe(true);
    expect(isGroupOwnerName('Ops & Legal')).toBe(true);
    expect(isGroupOwnerName('Smith, Jones')).toBe(true);
    expect(isGroupOwnerName('Marsha Turner (DBJ Finance)')).toBe(false);
    expect(isGroupOwnerName('Marsha Turner')).toBe(false);
    expect(isGroupOwnerName('')).toBe(false);
    expect(fired([item({ type: 'action', ownerId: null, ownerName: 'DBJ' })], 'RR05')).toBeTruthy();
    // A linked owner is a person, whatever the name text says
    expect(fired([item({ type: 'action', ownerId: 'u9', ownerName: 'DBJ' })], 'RR05')).toBeUndefined();
  });

  it('RR06 looks like the wrong type', () => {
    expect(looksLikeWrongType({ type: 'risk', title: 'Provide the test data to the vendor' })).toBe(true);
    expect(looksLikeWrongType({ type: 'risk', title: 'Follow up with DBJ on sign-off' })).toBe(true);
    expect(looksLikeWrongType({ type: 'risk', title: 'Set up the UAT environment' })).toBe(true);
    expect(looksLikeWrongType({ type: 'risk', title: 'Confirm budget — it may be cut' })).toBe(false);
    expect(looksLikeWrongType({ type: 'risk', title: 'Vendor could deliver late' })).toBe(false);
    expect(looksLikeWrongType({ type: 'risk', title: 'Testing environment unavailable' })).toBe(false); // "Testing" is not "Test"
    expect(looksLikeWrongType({ type: 'issue', title: 'Action: chase the vendor' })).toBe(true);
    expect(looksLikeWrongType({ type: 'issue', title: 'A-05 chase the vendor' })).toBe(true);
    expect(looksLikeWrongType({ type: 'issue', title: 'Server outage in UAT' })).toBe(false);
    expect(looksLikeWrongType({ type: 'action', title: 'Provide the data' })).toBe(false);
  });

  it('RR07 open issue with no response plan, workaround or root cause', () => {
    expect(fired([item({ type: 'issue', responsePlan: null, workaround: null, rootCause: null })], 'RR07')).toBeTruthy();
    expect(fired([item({ type: 'issue', responsePlan: null, workaround: 'manual', rootCause: null })], 'RR07')).toBeUndefined();
  });

  it('RR08 decided decision missing date, rationale or who decided', () => {
    expect(fired([item({ type: 'decision', status: 'decided', decisionDate: null })], 'RR08')).toBeTruthy();
    expect(fired([item({ type: 'decision', status: 'decided', rationale: '' })], 'RR08')).toBeTruthy();
    expect(fired([item({ type: 'decision', status: 'decided', decidedBy: null, ownerId: null, ownerName: null })], 'RR08')).toBeTruthy();
    expect(fired([item({ type: 'decision', status: 'decided', decidedBy: null, ownerId: null, ownerName: 'Board' })], 'RR08')).toBeUndefined();
    expect(fired([item({ type: 'decision', status: 'pending_decision', decisionDate: null })], 'RR08')).toBeUndefined();
  });

  it('RR09 assumption with no validation plan or due date', () => {
    expect(fired([item({ type: 'assumption', validationPlan: null })], 'RR09')).toBeTruthy();
    expect(fired([item({ type: 'assumption', status: 'unverified', dueDate: null })], 'RR09')).toBeTruthy();
    expect(fired([item({ type: 'assumption', status: 'validated', validationPlan: null, resolvedAt: '2026-09-01' })], 'RR09')).toBeUndefined();
    expect(fired([item({ type: 'assumption' })], 'RR09')).toBeUndefined();
  });

  it('RR10 closed item with no resolved date and no closure reason', () => {
    expect(fired([item({ type: 'action', status: 'completed', resolvedAt: null, closureReason: null })], 'RR10')).toBeTruthy();
    expect(fired([item({ type: 'action', status: 'completed', resolvedAt: '2026-09-01 10:00:00' })], 'RR10')).toBeUndefined();
    expect(fired([item({ type: 'action', status: 'completed', resolvedAt: null, closureReason: 'Done at steering' })], 'RR10')).toBeUndefined();
    expect(fired([item({ type: 'action', status: 'open', resolvedAt: null })], 'RR10')).toBeUndefined();
  });

  it('RR11 near-duplicate open items of the same type', () => {
    expect(jaccard(titleWords('Vendor delivery may be late'), titleWords('Vendor delivery may be late!'))).toBe(1);
    const a = item({ type: 'risk', title: 'Vendor delivery of servers may be late' });
    const b = item({ type: 'risk', title: 'Vendor delivery of the servers may be late' });
    const c = item({ type: 'issue', title: 'Vendor delivery of servers may be late' }); // other type
    const f = fired([a, b, c], 'RR11');
    expect(f?.items.map(i => i.id).sort()).toEqual([a.id, b.id].sort());
    expect(fired([a, item({ type: 'risk', title: 'Budget cut by finance could stop phase two' })], 'RR11')).toBeUndefined();
    expect(fired([a, { ...b, status: 'closed', resolvedAt: '2026-09-01' }], 'RR11')).toBeUndefined();
  });

  it('RR12 risk not written as cause, event and effect — info, no score effect', () => {
    expect(isCauseEventEffect({ title: 'Because of the freeze, go-live may slip', description: '' })).toBe(true);
    const flat = item({ type: 'risk', title: 'Vendor delivery', description: 'Servers from vendor' });
    const r = run([flat]);
    const f = r.findings.find(x => x.ruleId === 'RR12');
    expect(f?.severity).toBe('info');
    expect(f?.affectsScore).toBe(false);
    expect(r.score).toBe(100);
  });

  it('skips disabled rules', () => {
    const items = [item({ type: 'action', dueDate: null })];
    expect(run(items).findings.map(f => f.ruleId)).toContain('RR02');
    const off = run(items, ['RR02']);
    expect(off.findings.map(f => f.ruleId)).not.toContain('RR02');
    expect(off.score).toBe(100);
  });

  it('scores by weight and share, deterministically', () => {
    // RR02 high: 1 of 2 actions → 12 × (0.4 + 0.6 × 0.5) = 8.4 → 92 (rounded)
    const items = [item({ type: 'action', dueDate: null }), item({ type: 'action' })];
    expect(run(items).score).toBe(92);
    // All of them → 12 × 1.0 = 12 → 88
    expect(run([item({ type: 'action', dueDate: null })]).score).toBe(88);
    const again = run(items);
    expect(run(items)).toEqual(again);
  });

  it('floors the score at 0 and orders findings by severity', () => {
    const bad: RaidReviewItem[] = [];
    for (let i = 0; i < 5; i++) {
      bad.push(item({ type: 'risk', title: 'Provide data', description: '', severity: 'high', responseStrategy: null, ownerId: null, ownerName: 'DBJ', dueDate: '2026-01-01', updatedAt: '2026-01-01 00:00:00' }));
      bad.push(item({ type: 'action', dueDate: null, ownerId: null }));
      bad.push(item({ type: 'issue', title: 'Action chase', responsePlan: null, ownerId: null }));
      bad.push(item({ type: 'decision', status: 'decided', decisionDate: null }));
      bad.push(item({ type: 'assumption', validationPlan: null }));
      bad.push(item({ type: 'action', status: 'closed', resolvedAt: null }));
    }
    const r = run(bad);
    expect(r.score).toBeGreaterThanOrEqual(0);
    const order = r.findings.map(f => f.severity);
    const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
    expect([...order].sort((a, b) => rank[a] - rank[b])).toEqual(order);
  });
});
