import { describe, it, expect } from 'vitest';
import { memberSubscriptionFromOrg, orgSubscriptionAllowsMembers } from '../../utils/memberSubscription';

const now = new Date('2026-09-27T12:00:00Z');

describe('memberSubscriptionFromOrg', () => {
  it("copies a paying team's plan and clears any trial date", () => {
    expect(memberSubscriptionFromOrg({ subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: '2026-09-01' }))
      .toEqual({ subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null });
  });
  it('copies the trial end date for a team on its trial (invite links used to drop it)', () => {
    expect(memberSubscriptionFromOrg({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-10-10' }).trialEndsAt).toBe('2026-10-10');
  });
});

describe('orgSubscriptionAllowsMembers', () => {
  it('active paid, past due, and an unexpired trial allow', () => {
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null }, now)).toBe(true);
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'sme', subscriptionStatus: 'past_due', trialEndsAt: null }, now)).toBe(true);
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-10-01' }, now)).toBe(true);
  });
  it('expired trial, cancelled, awaiting payment, and "active" on the trial tier do not', () => {
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-09-01' }, now)).toBe(false);
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'sme', subscriptionStatus: 'canceled', trialEndsAt: null }, now)).toBe(false);
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'sme', subscriptionStatus: 'incomplete', trialEndsAt: null }, now)).toBe(false);
    expect(orgSubscriptionAllowsMembers({ subscriptionTier: 'trial', subscriptionStatus: 'active', trialEndsAt: null }, now)).toBe(false);
  });
});
