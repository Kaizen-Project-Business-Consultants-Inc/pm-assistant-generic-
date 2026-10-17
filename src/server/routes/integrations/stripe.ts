import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { resolvePriceId } from '../../utils/stripePrices';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';
import { stripeService, StripeService, PaymentsUnavailableError } from '../../services/StripeService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { tokenTopUpRepository } from '../../database/TokenTopUpRepository';
import { rateLimiter } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';
import { isPlatformAdmin } from '../../utils/platformAdmin';

/**
 * Buying a plan or credits, opening the billing portal, re-checking the subscription: the company
 * owner only (2026-10-08). A member could start a company-plan checkout, and once paid it rewrote
 * the whole company's plan, billing account and seat count. Someone with no company buys for
 * themselves; the Kovarti admin has no billing — refused here, not left to fail later for want of a
 * Stripe customer (2026-10-09 audit, low).
 */
async function billingOwnerOnly(request: FastifyRequest, reply: FastifyReply) {
  const u = request.user;
  if (isPlatformAdmin(u)) return reply.status(403).send({ error: 'Forbidden', message: 'The Kovarti admin account has no plan or billing.' });
  if (u && (u.isOwner || u.hasCompany === false)) return;
  return reply.status(403).send({ error: 'Forbidden', message: "Only the company's owner can change the plan or buy credits. Ask them to do it from Account." });
}

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'annual']).optional(),
  tier: z.enum(['consultant_basic', 'consultant_pro', 'sme', 'enterprise']).optional(),
  seats: z.number().int().min(3).max(100).optional(),
});

const LIVE = ['active', 'trialing', 'past_due'];

/** The person's own Stripe customer, made or remade when needed (see StripeService.usableCustomer) */
function userCustomer(user: { id: string; email: string; fullName?: string | null; stripeCustomerId: string | null; subscriptionTier?: string | null; subscriptionStatus?: string | null }) {
  return stripeService.usableCustomer({
    storedId: user.stripeCustomerId, email: user.email, name: user.fullName || user.email, userId: user.id,
    ownerKey: `user:${user.id}`,
    paying: !!user.subscriptionTier && user.subscriptionTier !== 'trial' && LIVE.includes(user.subscriptionStatus ?? ''),
    save: (id) => userService.update(user.id, { stripeCustomerId: id }),
  });
}

/** Payments that can't go ahead right now answer 503 with a plain message, not a 500 */
function paymentsUnavailable(reply: FastifyReply, error: unknown) {
  if (!(error instanceof PaymentsUnavailableError)) return null;
  return reply.status(503).send({ error: 'Payments unavailable', message: error.message });
}

export async function stripeRoutes(fastify: FastifyInstance) {
  // Stripe webhook — must receive raw body, no auth
  fastify.post('/webhook', {
    config: { rawBody: true },
    schema: { description: 'Stripe webhook endpoint', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['stripe-signature'] as string;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      return reply.status(400).send({ error: 'Missing raw body' });
    }

    // Step 1 — is this really from Stripe? A failure here is not a business
    // problem: either someone is posting to our endpoint, or STRIPE_WEBHOOK_SECRET
    // is wrong. Both need to be loud. This used to be swallowed by the same catch
    // as processing and answered 200.
    let event;
    try {
      event = stripeService.verifyWebhook(rawBody as Buffer, signature);
    } catch (error: any) {
      logger.error('Stripe webhook signature rejected', {
        message: error?.message,
        hint: 'Check STRIPE_WEBHOOK_SECRET matches the endpoint in the Stripe dashboard',
      });
      return reply.status(400).send({ error: 'Webhook signature verification failed' });
    }

    // Step 2 — Stripe sends far more than we act on. Acknowledge the rest so it
    // is not retried forever.
    if (!StripeService.HANDLED_EVENTS.has(event.type)) {
      return { received: true, handled: false };
    }

    try {
      await stripeService.processWebhookEvent(event);
      logger.info('Stripe webhook processed', { eventId: event.id, type: event.type });
      return { received: true, handled: true };
    } catch (error: any) {
      // A payment event we could not process is money taken without access
      // granted. Ask Stripe to retry — it backs off over roughly three days,
      // which is long enough to survive a restart or a database blip. The old
      // code answered 200 here, so every failure was lost silently: 16 of 54
      // deliveries in the 30 days to 2026-09-21.
      logger.error('Stripe webhook processing failed — asking Stripe to retry', {
        eventId: event.id,
        type: event.type,
        message: error?.message,
        stack: error?.stack,
      });
      return reply.status(500).send({ error: 'Processing failed', eventId: event.id });
    }
  });

  // Authenticated routes
  fastify.post('/create-checkout-session', {
    preHandler: [authMiddleware, requireScope('read'), billingOwnerOnly],
    schema: { description: 'Create Stripe checkout session', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limit: 5 checkout sessions per minute per user
      const rl = await rateLimiter.checkAsync(`checkout:${request.user!.userId}`, 5, 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many requests. Please try again later.' });
      }

      const userId = request.user!.userId;
      const parsed = checkoutSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid checkout parameters', message: parsed.error.issues.map(e => e.message).join(', ') });
      }
      const { plan, tier, seats } = parsed.data;
      const user = await userService.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const billing = plan || 'monthly';
      const selectedTier = tier || 'consultant_pro'; // default to consultant_pro for legacy clients
      const priceId = resolvePriceId(selectedTier, billing);

      if (!priceId) {
        return reply.status(500).send({ error: 'Stripe not configured', message: 'Pricing is not configured' });
      }

      // SME per-seat flow: use org-level subscription
      if (selectedTier === 'sme') {
        const org = await organizationRepository.findByUserId(userId);
        if (!org) {
          return reply.status(400).send({ error: 'No organization found', message: 'An organization is required for SME subscriptions' });
        }

        // The org's Stripe customer — made (or remade, if deleted in Stripe) when needed
        const orgStripeCustomerId = await stripeService.usableCustomer({
          storedId: org.stripeCustomerId, email: user.email, name: org.name, userId, ownerKey: `org:${org.id}`,
          paying: !!org.stripeSubscriptionId && LIVE.includes(org.subscriptionStatus),
          save: (id) => organizationRepository.update(org.id, { stripeCustomerId: id }),
        });

        const seatCount = Math.max(3, seats || await organizationRepository.countNonViewerUsers(org.id) || 3);
        const url = await stripeService.createSeatCheckoutSession(
          orgStripeCustomerId, priceId, seatCount, org.id,
        );
        return { url };
      }

      // Flat-rate flow (consultant/enterprise)
      const customerId = await userCustomer(user);

      // Apply launch coupon for Pro annual subscriptions
      let couponId: string | undefined;
      if (config.LAUNCH_OFFER_ENABLED && config.STRIPE_LAUNCH_COUPON_ID && selectedTier === 'consultant_pro' && billing === 'annual') {
        couponId = config.STRIPE_LAUNCH_COUPON_ID;
      }

      const url = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        userId,
        undefined,
        couponId,
      );

      return { url };
    } catch (error) {
      if (paymentsUnavailable(reply, error)) return reply;
      logger.error('Create checkout session error', { error });
      return reply.status(500).send({ error: 'Failed to create checkout session' });
    }
  });

  // Token top-up purchase
  fastify.post('/create-topup-session', {
    preHandler: [authMiddleware, requireScope('read'), billingOwnerOnly],
    schema: { description: 'Create Stripe checkout for token top-up', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const { quantity } = (request.body as { quantity?: unknown }) || {};
      // Text or a fraction became NaN / 2.5 packs and Stripe refused it as a 500 (2026-10-07)
      if (quantity != null && !(typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0)) {
        return reply.status(400).send({ error: 'Validation error', message: 'quantity must be a whole number of packs (1 or more).' });
      }
      const qty = Math.max(1, Math.min((quantity as number | undefined) || 1, 20)); // 1-20 packs

      const user = await userService.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const customerId = await userCustomer(user);

      const url = await stripeService.createTopUpSession(
        customerId,
        userId,
        qty,
      );

      return { url };
    } catch (error) {
      if (paymentsUnavailable(reply, error)) return reply;
      logger.error('Create top-up session error', { error });
      return reply.status(500).send({ error: 'Failed to create top-up session' });
    }
  });

  // Get token top-up balance and history
  fastify.get('/topup-balance', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'Get token top-up balance', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const remaining = await tokenTopUpRepository.getRemainingTokens(userId);
      const history = await tokenTopUpRepository.getPurchaseHistory(userId);
      return {
        remainingTopUpTokens: remaining,
        topUpConfig: {
          tokensPerPack: config.AI_TOPUP_TOKENS,
          pricePerPack: config.AI_TOPUP_PRICE_CENTS,
        },
        // only what a purchase list needs — not internal ids or the payment session (2026-10-08)
        history: history.map(h => ({
          tokensPurchased: h.tokens_purchased, tokensRemaining: h.tokens_remaining,
          amountCents: h.amount_cents, purchasedAt: h.purchased_at, expiresAt: h.expires_at,
        })),
      };
    } catch (error) {
      logger.error('Get top-up balance error', { error });
      return reply.status(500).send({ error: 'Failed to get balance' });
    }
  });

  fastify.post('/create-portal-session', {
    preHandler: [authMiddleware, requireScope('read'), billingOwnerOnly],
    schema: { description: 'Create Stripe billing portal session', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const user = await userService.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!stripeService.isConfigured) {
        return reply.status(503).send({ error: 'Payments unavailable', message: 'Payments are not set up yet. Please contact support.' });
      }
      // Per-seat companies are billed on the company's customer; a customer deleted in Stripe has
      // no billing to manage (a portal for it errors)
      const org = await organizationRepository.findByUserId(userId);
      const customerId = org?.billingModel === 'per_seat' && org.stripeCustomerId ? org.stripeCustomerId : user.stripeCustomerId;
      if (!customerId || !(await stripeService.customerExists(customerId))) {
        return reply.status(400).send({ error: 'No Stripe customer', message: 'No billing account found' });
      }

      const url = await stripeService.createBillingPortalSession(customerId);
      return { url };
    } catch (error) {
      if (paymentsUnavailable(reply, error)) return reply;
      logger.error('Create portal session error', { error });
      return reply.status(500).send({ error: 'Failed to create portal session' });
    }
  });

  fastify.get('/subscription-status', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'Get subscription status', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const status = await stripeService.getSubscriptionStatus(userId);
      return status;
    } catch (error) {
      logger.error('Get subscription status error', { error });
      return reply.status(500).send({ error: 'Failed to get subscription status' });
    }
  });

  // Called when someone returns from the payment page. Asks Stripe directly what
  // their subscription is rather than waiting for the webhook, which can be late or
  // lost — and a customer who has paid but whose confirmation went missing would
  // otherwise be locked out of what they just bought.
  fastify.post('/reconcile', {
    preHandler: [authMiddleware, requireScope('read'), billingOwnerOnly],
    schema: { description: 'Re-check this account\'s subscription directly with Stripe', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const applied = await stripeService.reconcileFromStripe(userId);
      const status = await stripeService.getSubscriptionStatus(userId);
      return { reconciled: applied, ...status };
    } catch (error) {
      logger.error('Reconcile subscription error', { error });
      return reply.status(500).send({ error: 'Failed to reconcile subscription' });
    }
  });

  // Public endpoint to get the publishable key
  fastify.get('/config', {
    schema: { description: 'Get Stripe publishable key', tags: ['stripe'] },
  }, async () => {
    // Report which tiers have Stripe price IDs configured
    const enabledTiers: string[] = [];
    for (const tier of ['consultant_basic', 'consultant_pro', 'sme', 'enterprise']) {
      if (resolvePriceId(tier, 'monthly')) enabledTiers.push(tier);
    }
    return {
      publishableKey: config.STRIPE_PUBLISHABLE_KEY,
      launchOfferEnabled: config.LAUNCH_OFFER_ENABLED,
      launchOfferDiscount: config.LAUNCH_OFFER_ENABLED ? 20 : 0,
      enabledTiers,
    };
  });
}
