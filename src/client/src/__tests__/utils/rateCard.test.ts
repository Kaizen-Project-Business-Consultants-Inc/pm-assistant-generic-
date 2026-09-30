import { describe, it, expect } from 'vitest';
import { cardRateOn, nextCardRate } from '../../utils/rateCard';

const card = [
  { id: 'a', role: 'Developer', hourlyRate: 95, overtimeRate: null, effectiveFrom: '2026-01-01' },
  { id: 'b', role: 'Developer', hourlyRate: 100, overtimeRate: null, effectiveFrom: '2026-10-01' },
  { id: 'c', role: 'Designer', hourlyRate: 80, overtimeRate: null, effectiveFrom: '2026-01-01' },
];

describe('rate card helpers', () => {
  it('finds the rate in force on a day, matching the role loosely', () => {
    expect(cardRateOn(' developer', '2026-09-30', card)?.hourlyRate).toBe(95);
    expect(cardRateOn('Developer', '2026-10-01', card)?.hourlyRate).toBe(100);
    expect(cardRateOn('Developer', '2025-12-31', card)).toBeNull();
    expect(cardRateOn('Tester', '2026-10-01', card)).toBeNull();
  });
  it('finds the next rate change', () => {
    expect(nextCardRate('Developer', '2026-09-30', card)?.effectiveFrom).toBe('2026-10-01');
    expect(nextCardRate('Developer', '2026-10-01', card)).toBeNull();
  });
});
