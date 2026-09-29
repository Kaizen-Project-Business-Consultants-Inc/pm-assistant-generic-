import { describe, it, expect } from 'vitest';
import {
  ruleShortLabel, scoreBand, scoreBandClass, itemFlags, fixesMissingInput, buildApplyEntries,
  initialFixValues, isClosedStatus, itemChipText,
  type RaidFix, type RaidReview,
} from '../../components/raids/review/raidReviewHelpers';

describe('ruleShortLabel', () => {
  it('maps every known rule to its short label', () => {
    expect(ruleShortLabel('RR01', 'x')).toBe('No response strategy');
    expect(ruleShortLabel('RR02', 'x')).toBe('No due date');
    expect(ruleShortLabel('RR03', 'x')).toBe('No owner');
    expect(ruleShortLabel('RR04', 'x')).toBe('Overdue, not updated');
    expect(ruleShortLabel('RR05', 'x')).toBe('Owner is a group');
    expect(ruleShortLabel('RR06', 'x')).toBe('Looks like the wrong type');
    expect(ruleShortLabel('RR07', 'x')).toBe('No resolution plan');
    expect(ruleShortLabel('RR08', 'x')).toBe('Decision incomplete');
    expect(ruleShortLabel('RR09', 'x')).toBe('No validation plan');
    expect(ruleShortLabel('RR10', 'x')).toBe('No closure details');
    expect(ruleShortLabel('RR11', 'x')).toBe('Possible duplicate');
  });
  it('falls back to the finding title for an unknown rule', () => {
    expect(ruleShortLabel('RR99', 'Something new')).toBe('Something new');
  });
});

describe('score band colour', () => {
  it('is green at 80 and above', () => {
    expect(scoreBand(80)).toBe('good');
    expect(scoreBand(100)).toBe('good');
    expect(scoreBandClass(85)).toContain('green');
  });
  it('is amber from 60 to 79', () => {
    expect(scoreBand(60)).toBe('fair');
    expect(scoreBand(79)).toBe('fair');
    expect(scoreBandClass(70)).toContain('amber');
  });
  it('is red below 60', () => {
    expect(scoreBand(59)).toBe('poor');
    expect(scoreBand(0)).toBe('poor');
    expect(scoreBandClass(30)).toContain('red');
  });
});

describe('itemFlags', () => {
  const review: RaidReview = {
    id: 'r', projectId: 'p', score: 70, rulesVersion: '1.0', itemsChecked: 3, createdAt: '2026-09-29T10:00:00Z', disabledRules: [],
    findings: [
      { ruleId: 'RR99', severity: 'info', title: 'Tip', standard: '', affectsScore: false, items: [{ id: 'c', recordId: 'R-3', title: 'C' }] },
      { ruleId: 'RR02', severity: 'medium', title: 'Missing due date', standard: '', affectsScore: true, items: [{ id: 'a', recordId: 'R-1', title: 'A' }] },
      { ruleId: 'RR06', severity: 'high', title: 'Wrong type', standard: '', affectsScore: true, items: [{ id: 'a', recordId: 'R-1', title: 'A' }, { id: 'b', recordId: 'R-2', title: 'B' }] },
    ],
  };
  it('uses the most severe finding per item and skips suggestions', () => {
    const flags = itemFlags(review);
    expect(flags.get('a')?.label).toBe('Looks like the wrong type');
    expect(flags.get('b')?.label).toBe('Looks like the wrong type');
    expect(flags.has('c')).toBe(false);
  });
  it('is empty without a review', () => {
    expect(itemFlags(null).size).toBe(0);
  });
});

describe('fix panel — a ticked fix needs its value before Apply', () => {
  const fixes: RaidFix[] = [
    { id: 'f1', kind: 'set_owner', itemId: 'a', recordId: 'R-1', itemTitle: 'A', text: 'Name an owner', reason: '', confidence: 0.8, defaultChecked: true, input: { type: 'person' } },
    { id: 'f2', kind: 'set_due_date', itemId: 'b', recordId: 'R-2', itemTitle: 'B', text: 'Set due date', reason: '', confidence: 0.8, defaultChecked: true, input: { type: 'date', suggested: '2026-10-15' } },
    { id: 'f3', kind: 'change_type', itemId: 'c', recordId: 'R-3', itemTitle: 'C', text: 'Make it an action', reason: '', confidence: 0.9, defaultChecked: true, toType: 'action' },
  ];

  it('flags a ticked person fix with no person chosen', () => {
    const values = initialFixValues(fixes);
    expect(values).toEqual({ f1: '', f2: '2026-10-15' });
    expect(fixesMissingInput(fixes, new Set(['f1', 'f2', 'f3']), values)).toEqual(['f1']);
  });
  it('does not flag an unticked fix', () => {
    expect(fixesMissingInput(fixes, new Set(['f2', 'f3']), { f1: '', f2: '2026-10-15' })).toEqual([]);
  });
  it('treats whitespace as empty', () => {
    expect(fixesMissingInput(fixes, new Set(['f1']), { f1: '   ' })).toEqual(['f1']);
  });
  it('is satisfied once a person is chosen, and sends value and toType', () => {
    const values = { f1: 'user-1', f2: '2026-10-15' };
    const selected = new Set(['f1', 'f2', 'f3']);
    expect(fixesMissingInput(fixes, selected, values)).toEqual([]);
    expect(buildApplyEntries(fixes, selected, values)).toEqual([
      { id: 'f1', kind: 'set_owner', itemId: 'a', value: 'user-1' },
      { id: 'f2', kind: 'set_due_date', itemId: 'b', value: '2026-10-15' },
      { id: 'f3', kind: 'change_type', itemId: 'c', toType: 'action' },
    ]);
  });
});

describe('small helpers', () => {
  it('knows which statuses are finished', () => {
    expect(isClosedStatus('closed')).toBe(true);
    expect(isClosedStatus('resolved')).toBe(true);
    expect(isClosedStatus('completed')).toBe(true);
    expect(isClosedStatus('open')).toBe(false);
    expect(isClosedStatus(null)).toBe(false);
  });
  it('shortens long item titles on chips', () => {
    expect(itemChipText({ id: 'x', recordId: 'R-10', title: 'Short' })).toBe('R-10 · Short');
    const long = itemChipText({ id: 'x', recordId: null, title: 'A'.repeat(50) });
    expect(long.length).toBe(32);
    expect(long.endsWith('…')).toBe(true);
  });
});
