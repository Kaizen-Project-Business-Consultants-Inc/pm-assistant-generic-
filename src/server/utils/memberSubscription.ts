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

/**
 * The company's plan as it really stands. Per-seat billing keeps it on the organisation row; on flat
 * (consultant) billing Stripe updates only the owner's own record and the organisation row keeps its
 * sign-up values for good (migration 120: "the owner's own record stays authoritative"), so the
 * owner's record is the company's plan. Callers load the owner only for flat billing.
 */
export function companyPlan(
  org: OrgBilling & { billingModel?: string | null },
  owner: Pick<OrgBilling, 'subscriptionTier' | 'subscriptionStatus' | 'trialEndsAt'> | null,
): OrgBilling {
  if (org.billingModel === 'per_seat' || !owner) return org;
  return { ownerUserId: org.ownerUserId, subscriptionTier: owner.subscriptionTier, subscriptionStatus: owner.subscriptionStatus, trialEndsAt: owner.trialEndsAt };
}

/**
 * Is the person's plan in force? The write guard's rule (requireSubscription), now also for plan
 * features and AI: an ended trial or cancelled company kept every paid feature on reads, AI
 * included (2026-10-12).
 * - Awaiting payment ('incomplete'): no, whatever the company says — they only get checkout.
 * - Their own record: paid or past due, or a trial not yet ended.
 * - Else the company's plan (see companyPlan) — for a member whose own record lags, never for the
 *   company's owner (their own record is the plan).
 * - A viewer keeps a default record, so only the company counts; a viewer with no company has no plan.
 */
export function planInForce(role: string, userId: string, own: OrgBilling, company: OrgBilling | null, now = new Date()): boolean {
  if (role === 'viewer') return !!company && orgSubscriptionAllowsMembers(company, now);
  if (own.subscriptionStatus === 'incomplete') return false;
  if (orgSubscriptionAllowsMembers(own, now)) return true;
  return !!company && company.ownerUserId !== userId && orgSubscriptionAllowsMembers(company, now);
}
