import { FastifyRequest, FastifyReply } from 'fastify';
import { userService } from '../services/UserService';
import { pricingConfigService } from '../services/PricingConfigService';
import { organizationRepository } from '../database/OrganizationRepository';
import { planTierFor } from '../utils/planTier';
import { planInForce, orgSubscriptionAllowsMembers, companyPlan } from '../utils/memberSubscription';
import { createError } from '@fastify/error';
import type { FeatureKey } from '../constants/planFeatures';

/** The app shows this in its upgrade window when someone tries a paid-plan feature */
export const UPGRADE_REQUIRED_MESSAGE = "This is part of Kovarti's paid plans. Choose a plan to use it — everything you've set up stays as it is.";
/** The same window, when the plan they had has ended (they used the feature yesterday) */
export const PLAN_ENDED_MESSAGE = "Your trial or subscription has ended. Choose a plan to keep using this — everything you've set up stays as it is.";
const UpgradeRequiredError = createError('UPGRADE_REQUIRED', UPGRADE_REQUIRED_MESSAGE, 403);
const PlanEndedError = createError('UPGRADE_REQUIRED', PLAN_ENDED_MESSAGE, 403);
const AuthRequiredError = createError('AUTH_REQUIRED', 'Authentication required', 401);

/**
 * The caller's plan: its tier (a viewer's is the company's) and whether it is in force (see
 * planInForce). Admin, and the admin's read-only support visit: not on a plan. The company is looked
 * up only when needed — for a viewer, or when the person's own record says their plan has lapsed —
 * and on flat billing its plan is the owner's record (companyPlan).
 */
async function callerPlan(request: FastifyRequest): Promise<{ tier: string; inForce: boolean } | 'admin' | 'auth'> {
  const role = request.user?.role ?? '';
  if (role === 'admin' || request.supportSession) return 'admin';
  const userId = request.user?.userId;
  if (!userId) return 'auth';
  const user = await userService.findById(userId);
  if (!user) return 'auth';
  const own = { ownerUserId: null, subscriptionTier: user.subscriptionTier, subscriptionStatus: user.subscriptionStatus, trialEndsAt: user.trialEndsAt };
  let company = null;
  if (role === 'viewer' || !orgSubscriptionAllowsMembers(own)) {
    const org = await organizationRepository.findByUserId(userId);
    if (org) {
      const owner = org.billingModel !== 'per_seat' && org.ownerUserId && org.ownerUserId !== userId
        ? await userService.findById(org.ownerUserId)
        : null;
      company = companyPlan(org, owner);
    }
  }
  return {
    tier: planTierFor(role, user.subscriptionTier, company?.subscriptionTier),
    inForce: planInForce(role, userId, own, company),
  };
}

/**
 * Only these plans, and only while the plan is in force. Viewers are judged by the company's plan;
 * they used to pass every tier gate.
 */
export function requireTier(...allowedTiers: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const plan = await callerPlan(request);
    if (plan === 'admin') return;
    if (plan === 'auth') throw new AuthRequiredError();
    if (!plan.inForce) throw new PlanEndedError();
    if (!allowedTiers.includes(plan.tier)) throw new UpgradeRequiredError();
  };
}

/** Whether the caller's plan has a feature: 'ok', 'off' (not on their plan), 'ended' (their plan ended) or 'auth' (no such user) */
async function featureAccess(request: FastifyRequest, featureKey: FeatureKey): Promise<'ok' | 'off' | 'ended' | 'auth'> {
  const plan = await callerPlan(request);
  if (plan === 'admin') return 'ok';
  if (plan === 'auth') return 'auth';
  // an ended trial or cancelled plan has no paid features (it kept them on reads before)
  if (!plan.inForce) return 'ended';
  return (await pricingConfigService.isFeatureEnabled(plan.tier, featureKey)) ? 'ok' : 'off';
}

/**
 * Does the caller's plan include this feature? The same answer requireFeature enforces — also used
 * to tell a screen whether to show a control at all (hide, don't disable), e.g. "Analyse with AI".
 */
export async function hasFeature(request: FastifyRequest, featureKey: FeatureKey): Promise<boolean> {
  return (await featureAccess(request, featureKey)) === 'ok';
}

export function requireFeature(featureKey: FeatureKey) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const access = await featureAccess(request, featureKey);
    if (access === 'auth') throw new AuthRequiredError();
    if (access === 'ended') throw new PlanEndedError();
    if (access === 'off') throw new UpgradeRequiredError();
  };
}
