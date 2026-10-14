import { describe, it, expect } from 'vitest';
import { needsSetup } from '../../utils/needsSetup';

/** Setup screens follow "finished setup", not "has a name" (free-trial sign-ups skipped setup, 2026-10-14) */
describe('needsSetup', () => {
  it('a sign-up who gave a name but has not finished setup goes to setup', () => {
    expect(needsSetup({ fullName: 'George', onboardingCompleted: false })).toBe(true);
  });
  it('someone who finished setup does not, even without a name', () => {
    expect(needsSetup({ fullName: '', onboardingCompleted: true })).toBe(false);
  });
  it('an older payload without the flag falls back to the name', () => {
    expect(needsSetup({ fullName: '' })).toBe(true);
    expect(needsSetup({ fullName: 'Ann' })).toBe(false);
  });
  it('no user yet: nothing to decide', () => {
    expect(needsSetup(null)).toBe(false);
  });
});
