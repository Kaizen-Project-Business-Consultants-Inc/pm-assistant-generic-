import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { userService } from '../../services/UserService';
import { stripeService } from '../../services/StripeService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { tokenTopUpRepository } from '../../database/TokenTopUpRepository';
import { rateLimiter } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';

const checkoutSchema = z.object({
  plan: z.enum(['monthly', 'annual']).optional(),
  tier: z.enum(['consultant_basic', 'consultant_pro', 'sme', 'enterprise']).optional(),
  seats: z.number().int().min(3).max(100).optional(),
});

export function resolvePriceId(tier: string, billing: string): string | undefined {
  // Consultant Basic
  if (tier === 'consultant_basic') {
    if (billing === 'annual' && config.STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID) return config.STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID;
    if (config.STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID) return config.STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID;
  }
  // Consultant Pro
  if (tier === 'consultant_pro') {
    if (billing === 'annual' && config.STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID) return config.STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID;
    if (config.STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID) return config.STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID;
    // Legacy fallbacks for existing consultant subscribers
    if (billing === 'annual' && config.STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID) return config.STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID;
    if (config.STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID) return config.STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID;
    if (billing === 'annual' && config.STRIPE_PRO_ANNUAL_PRICE_ID) return config.STRIPE_PRO_ANNUAL_PRICE_ID;
    if (config.STRIPE_PRO_MONTHLY_PRICE_ID) return config.STRIPE_PRO_MONTHLY_PRICE_ID;
  }
  if (tier === 'sme') {
    // Per-seat pricing (new default)
    if (billing === 'annual' && config.STRIPE_SME_SEAT_ANNUAL_PRICE_ID) return config.STRIPE_SME_SEAT_ANNUAL_PRICE_ID;
    if (config.STRIPE_SME_SEAT_MONTHLY_PRICE_ID) return config.STRIPE_SME_SEAT_MONTHLY_PRICE_ID;
    // Legacy flat-rate fallback
    if (billing === 'annual' && config.STRIPE_SME_ANNUAL_PRICE_ID) return config.STRIPE_SME_ANNUAL_PRICE_ID;
    if (config.STRIPE_SME_MONTHLY_PRICE_ID) return config.STRIPE_SME_MONTHLY_PRICE_ID;
    // Legacy business fallback
    if (billing === 'annual' && config.STRIPE_BUSINESS_ANNUAL_PRICE_ID) return config.STRIPE_BUSINESS_ANNUAL_PRICE_ID;
    if (config.STRIPE_BUSINESS_MONTHLY_PRICE_ID) return config.STRIPE_BUSINESS_MONTHLY_PRICE_ID;
  }
  if (tier === 'enterprise') {
    if (billing === 'annual' && config.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID) return config.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID;
    if (config.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID) return config.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID;
    // Legacy consultant fallback
    if (billing === 'annual' && config.STRIPE_CONSULTANT_ANNUAL_PRICE_ID) return config.STRIPE_CONSULTANT_ANNUAL_PRICE_ID;
    if (config.STRIPE_CONSULTANT_MONTHLY_PRICE_ID) return config.STRIPE_CONSULTANT_MONTHLY_PRICE_ID;
  }

  // Legacy fallback (single-plan era)
  if (billing === 'annual' && config.STRIPE_ANNUAL_PRICE_ID) return config.STRIPE_ANNUAL_PRICE_ID;
  if (config.STRIPE_MONTHLY_PRICE_ID) return config.STRIPE_MONTHLY_PRICE_ID;
  return config.STRIPE_PRO_PRICE_ID || undefined;
}

export async function stripeRoutes(fastify: FastifyInstance) {
  // Stripe webhook — must receive raw body, no auth
  fastify.post('/webhook', {
    config: { rawBody: true },
    schema: { description: 'Stripe webhook endpoint', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = request.headers['stripe-signature'] as string;
      if (!signature) {
        return reply.status(400).send({ error: 'Missing stripe-signature header' });
      }

      const rawBody = request.rawBody;
      if (!rawBody) {
        return reply.status(400).send({ error: 'Missing raw body' });
      }

      await stripeService.handleWebhookEvent(rawBody as Buffer, signature);
      return { received: true };
    } catch (error) {
      logger.error('Stripe webhook error', { error });
      return reply.status(400).send({ error: 'Webhook processing failed' });
    }
  });

  // Authenticated routes
  fastify.post('/create-checkout-session', {
    preHandler: [authMiddleware, requireScope('read')],
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

        // Ensure org has a Stripe customer
        let orgStripeCustomerId = org.stripeCustomerId;
        if (!orgStripeCustomerId) {
          orgStripeCustomerId = await stripeService.createCustomer(
            user.email, org.name, userId,
          );
          if (orgStripeCustomerId) {
            await organizationRepository.update(org.id, { stripeCustomerId: orgStripeCustomerId });
          }
        }

        if (!orgStripeCustomerId) {
          return reply.status(500).send({ error: 'Failed to create Stripe customer for organization' });
        }

        const seatCount = Math.max(3, seats || await organizationRepository.countNonViewerUsers(org.id) || 3);
        const url = await stripeService.createSeatCheckoutSession(
          orgStripeCustomerId, priceId, seatCount, org.id,
        );
        return { url };
      }

      // Flat-rate flow (consultant/enterprise)
      if (!user.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer', message: 'Please contact support' });
      }

      const url = await stripeService.createCheckoutSession(
        user.stripeCustomerId,
        priceId,
        userId
      );

      return { url };
    } catch (error) {
      logger.error('Create checkout session error', { error });
      return reply.status(500).send({ error: 'Failed to create checkout session' });
    }
  });

  // Token top-up purchase
  fastify.post('/create-topup-session', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'Create Stripe checkout for token top-up', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const { quantity } = (request.body as { quantity?: number }) || {};
      const qty = Math.max(1, Math.min(quantity || 1, 20)); // 1-20 packs

      const user = await userService.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!user.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer', message: 'Please contact support' });
      }

      const url = await stripeService.createTopUpSession(
        user.stripeCustomerId,
        userId,
        qty,
      );

      return { url };
    } catch (error) {
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
        history,
      };
    } catch (error) {
      logger.error('Get top-up balance error', { error });
      return reply.status(500).send({ error: 'Failed to get balance' });
    }
  });

  fastify.post('/create-portal-session', {
    preHandler: [authMiddleware, requireScope('read')],
    schema: { description: 'Create Stripe billing portal session', tags: ['stripe'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;
      const user = await userService.findById(userId);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      if (!user.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer', message: 'No billing account found' });
      }

      const url = await stripeService.createBillingPortalSession(user.stripeCustomerId);
      return { url };
    } catch (error) {
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

  // Public endpoint to get the publishable key
  fastify.get('/config', {
    schema: { description: 'Get Stripe publishable key', tags: ['stripe'] },
  }, async () => {
    return { publishableKey: config.STRIPE_PUBLISHABLE_KEY };
  });
}
