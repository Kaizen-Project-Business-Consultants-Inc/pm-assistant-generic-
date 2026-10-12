import { FastifyRequest, FastifyReply } from 'fastify';
import { userService } from '../services/UserService';
import { pricingConfigService } from '../services/PricingConfigService';
import { createError } from '@fastify/error';
import type { FeatureKey } from '../constants/planFeatures';

/** The app shows this in its upgrade window when someone tries a paid-plan feature */
export const UPGRADE_REQUIRED_MESSAGE = "This is part of Kovarti's paid plans. Choose a plan to use it — everything you've set up stays as it is.";
const UpgradeRequiredError = createError('UPGRADE_REQUIRED', UPGRADE_REQUIRED_MESSAGE, 403);
const AuthRequiredError = createError('AUTH_REQUIRED', 'Authentication required', 401);

export function requireTier(...allowedTiers: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (request.user?.role === 'admin') return;
    if (request.user?.role === 'viewer') return;

    const userId = request.user?.userId;
    if (!userId) {
      throw new AuthRequiredError();
    }

    const user = await userService.findById(userId);
    if (!user) {
      throw new AuthRequiredError();
    }

    const tier = user.subscriptionTier;
    if (!allowedTiers.includes(tier)) {
      throw new UpgradeRequiredError();
    }
  };
}

/** Whether the caller's plan has a feature: 'ok', 'off' (not on their plan) or 'auth' (no such user) */
async function featureAccess(request: FastifyRequest, featureKey: FeatureKey): Promise<'ok' | 'off' | 'auth'> {
  if (request.user?.role === 'admin') return 'ok';
  if (request.user?.role === 'viewer') return 'ok';
  const userId = request.user?.userId;
  if (!userId) return 'auth';
  const user = await userService.findById(userId);
  if (!user) return 'auth';
  return (await pricingConfigService.isFeatureEnabled(user.subscriptionTier, featureKey)) ? 'ok' : 'off';
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
    if (access === 'off') throw new UpgradeRequiredError();
  };
}
