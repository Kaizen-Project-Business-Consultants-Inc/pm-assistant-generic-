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

export function requireFeature(featureKey: FeatureKey) {
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

    const enabled = await pricingConfigService.isFeatureEnabled(user.subscriptionTier, featureKey);
    if (!enabled) {
      throw new UpgradeRequiredError();
    }
  };
}

export const requirePaidTier = requireTier('consultant_basic', 'consultant_pro', 'sme', 'enterprise');
