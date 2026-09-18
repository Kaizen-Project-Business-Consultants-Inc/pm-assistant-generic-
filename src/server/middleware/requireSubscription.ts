import { FastifyRequest, FastifyReply } from 'fastify';
import { userService } from '../services/UserService';
import logger from '../utils/logger';

/**
 * Middleware that enforces an active subscription (or active trial) for write operations.
 *
 * Allowed through:
 *   - Admin users (always bypass)
 *   - Users with subscriptionStatus 'active'
 *   - Users with subscriptionStatus 'trialing' AND trialEndsAt in the future
 *
 * Blocked (returns 403):
 *   - Users with expired trial (trialEndsAt in the past, no active subscription)
 *   - Users with 'canceled', 'past_due', 'incomplete', or 'none' status
 *
 * Read-only routes should NOT use this middleware — only apply to write routes.
 */
export async function requireActiveSubscription(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  // Admins always bypass subscription checks
  if (user.role === 'admin') {
    return;
  }

  // Viewers are free accounts — always allow (they have limited access via scope)
  if (user.role === 'viewer') {
    return;
  }

  try {
    const fullUser = await userService.findById(user.userId);
    if (!fullUser) {
      return reply.status(401).send({ error: 'User not found' });
    }

    const { subscriptionStatus, subscriptionTier, trialEndsAt, pendingTier } = fullUser;

    // Active paid subscription — allow
    if (subscriptionStatus === 'active' && subscriptionTier !== 'trial') {
      return;
    }

    // Awaiting payment: they chose a paid plan and have not paid yet. They are NOT a
    // free-tier customer and have no trial, so they get nothing but their checkout.
    // Answered separately from an expired trial because the message and the next
    // action are different — "finish paying", not "your trial ended".
    if (subscriptionStatus === 'incomplete') {
      return reply.status(403).send({
        error: 'Payment required',
        message: 'Complete your subscription to start using Kovarti PM.',
        upgradeUrl: '/pricing',
        subscriptionStatus,
        pendingTier: pendingTier ?? null,
        awaitingPayment: true,
        trialExpired: false,
      });
    }

    // Active trial — check expiry. Free tier only: a paid account never has a trial
    // date, so this branch cannot strand a subscriber.
    if (subscriptionStatus === 'trialing' || (subscriptionStatus === 'none' && trialEndsAt)) {
      if (trialEndsAt && new Date(trialEndsAt) > new Date()) {
        return;
      }
    }

    // Past due — allow with warning (Stripe will handle dunning)
    if (subscriptionStatus === 'past_due') {
      return;
    }

    // All other cases: expired trial, canceled, incomplete, none, free
    logger.info('Subscription gate blocked request', {
      userId: user.userId,
      subscriptionTier,
      subscriptionStatus,
      trialEndsAt: trialEndsAt?.toISOString() ?? null,
      method: request.method,
      url: request.url,
    });

    return reply.status(403).send({
      error: 'Subscription required',
      message: subscriptionStatus === 'canceled'
        ? 'Your subscription has ended. Resubscribe to continue.'
        : 'Your trial has ended. Subscribe to continue using this feature.',
      upgradeUrl: '/pricing',
      subscriptionStatus,
      trialExpired: trialEndsAt ? new Date(trialEndsAt) <= new Date() : false,
    });
  } catch (error) {
    logger.error('Subscription check error', { error, userId: user.userId });
    // Fail open — don't block users due to internal errors
    return;
  }
}
