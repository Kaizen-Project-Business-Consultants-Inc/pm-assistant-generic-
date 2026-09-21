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

/**
 * The trial has to actually end.
 *
 * `requireActiveSubscription` below was written in July and applied to nothing —
 * zero call sites — so an expired trial kept full write access indefinitely.
 * Verified on staging: an account whose trial ended the previous day created a
 * project without complaint. Nobody ever had to pay.
 *
 * This runs once, globally, rather than being added to 282 write routes. Editing
 * every route is how a paying customer gets blocked by an oversight nobody can
 * review; one list can be read in full and argued with.
 *
 * Reading is always allowed. What someone built during their trial is the reason
 * to subscribe, so locking them out of their own work would be self-defeating.
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths that must work even when the subscription is dead.
 *
 * Getting this list wrong in the generous direction costs a little revenue;
 * getting it wrong in the strict direction traps a customer who is trying to
 * pay, which is far worse. When in doubt, it is on the list.
 */
const ALWAYS_ALLOWED = [
  '/api/v1/auth',          // sign in and out, verify, reset a password
  '/api/v1/stripe',        // checkout and Stripe's own callbacks — they must be able to pay
  '/api/v1/pricing',
  '/api/v1/seats',         // buying seats is buying
  '/api/v1/org',           // managing the subscription lives here
  '/api/v1/users',         // your own profile and password
  '/api/v1/notifications', // marking things read, so the app is not visibly broken
  '/api/v1/exports',       // your data stays yours when you stop paying
  '/api/v1/feedback',      // let them tell us it is wrong
  '/api/v1/admin',
  '/api/v1/health',
];

export async function subscriptionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!WRITE_METHODS.has(request.method)) return;

  const url = request.url.split('?')[0];
  if (ALWAYS_ALLOWED.some((prefix) => url.startsWith(prefix))) return;

  // Unauthenticated writes are someone else's problem — auth runs after this and
  // will reject them. Answering here would turn a 401 into a confusing 403.
  if (!request.user) return;

  return requireActiveSubscription(request, reply);
}

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
