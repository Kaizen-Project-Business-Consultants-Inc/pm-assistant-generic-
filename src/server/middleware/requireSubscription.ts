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
  // --- they must be able to get in, and to pay ---
  '/api/v1/auth',                 // sign in and out, verify, reset a password
  '/api/v1/stripe',               // checkout and Stripe's own callbacks
  '/api/v1/pricing',
  '/api/v1/seats',                // buying seats is buying
  '/api/v1/org',                  // managing the subscription lives here

  // --- writes that are really reads ---
  // These POST because they take a body, not because they change anything.
  // Blocking them would make the product look broken rather than expired.
  '/api/v1/nl-query',
  '/api/v1/meeting-intelligence/analyze',
  '/api/v1/exports',              // and your data stays yours when you stop paying

  // --- public or machine endpoints that have no subscriber at all ---
  '/api/v1/portal',               // the client portal: the viewer is not a customer
  '/api/v1/ws',
  '/api/v1/waitlist',
  '/mcp',

  // --- housekeeping ---
  '/api/v1/users/me',             // your own profile and password, nothing wider
  '/api/v1/notifications',        // marking things read, so the app is not visibly broken
  '/api/v1/feedback',             // let them tell us it is wrong
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
      // Dates arrive as strings from the pool (dateStrings: true), so calling
      // toISOString() here threw — and the catch below treated that as "the
      // check broke, let them through". The gate silently never blocked anyone.
      trialEndsAt: trialEndsAt ? String(trialEndsAt) : null,
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
  } catch (error: any) {
    // Failing open is right — an outage must not lock paying customers out —
    // but it hides bugs in this very function, so the reason has to be legible.
    // Logging the raw error object serialises to {"name":"TypeError"}: no
    // message, no stack, which is exactly how the bug above went unnoticed.
    logger.error('Subscription check error — allowing the request', {
      userId: user.userId,
      message: error?.message,
      stack: error?.stack,
    });
    return;
  }
}
