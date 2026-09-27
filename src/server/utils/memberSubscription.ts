/**
 * A team member's subscription comes from their ORGANISATION (Sep 2026 fix).
 *
 * Paying for a team plan updates the organisation and copies the plan onto everyone on
 * the team at that moment. People invited afterwards were created with no subscription
 * ('none') — or, via an invite link, without the trial end date — so the subscription
 * check refused every change they made ("Your trial has ended"), on paying customers'
 * teams. Every way a person joins an organisation now uses this, and the check falls
 * back to the organisation for non-owner members.
 */
export interface OrgBilling {
  ownerUserId?: string | null;
  subscriptionTier: string;
  subscriptionStatus: string;
  trialEndsAt: string | Date | null;
}

/** The subscription fields a new non-viewer member should get from their organisation */
export function memberSubscriptionFromOrg(org: OrgBilling): { subscriptionTier: string; subscriptionStatus: string; trialEndsAt: string | Date | null } {
  return {
    subscriptionTier: org.subscriptionTier,
    subscriptionStatus: org.subscriptionStatus,
    trialEndsAt: org.subscriptionStatus === 'active' ? null : org.trialEndsAt,
  };
}

/** Does the organisation's own subscription currently allow its members to make changes? */
export function orgSubscriptionAllowsMembers(org: OrgBilling, now = new Date()): boolean {
  if (org.subscriptionStatus === 'active' && org.subscriptionTier !== 'trial') return true;
  if (org.subscriptionStatus === 'past_due') return true;
  if ((org.subscriptionStatus === 'trialing' || org.subscriptionStatus === 'none') && org.trialEndsAt) {
    return new Date(org.trialEndsAt) > now;
  }
  return false;
}
