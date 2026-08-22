import Stripe from 'stripe';
import { config } from '../config';
import { UserService } from './UserService';
import { subscriptionRepository } from '../database/SubscriptionRepository';
import { tokenTopUpRepository } from '../database/TokenTopUpRepository';
import { subscriptionEventRepository } from '../database/SubscriptionEventRepository';
import { organizationRepository } from '../database/OrganizationRepository';
import { auditLedgerService } from './AuditLedgerService';
import { databaseService } from '../database/connection';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

export class StripeService {
  private stripe: Stripe | null = null;
  private userService = new UserService();

  private getClient(): Stripe {
    if (!this.stripe) {
      if (!config.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
      }
      this.stripe = new Stripe(config.STRIPE_SECRET_KEY);
    }
    return this.stripe;
  }

  get isConfigured(): boolean {
    return !!config.STRIPE_SECRET_KEY;
  }

  async createCustomer(email: string, name: string, userId: string): Promise<string | null> {
    if (!this.isConfigured) {
      logger.info(`[StripeService] Would create customer for [email_redacted]`);
      return null;
    }

    const customer = await this.getClient().customers.create({
      email,
      name,
      metadata: { userId },
    });
    return customer.id;
  }

  async createCheckoutSession(customerId: string, priceId: string, userId: string, successPath?: string, couponId?: string): Promise<string> {
    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        metadata: { userId },
      },
      success_url: `${config.APP_URL}${successPath || '/dashboard'}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.APP_URL}/pricing`,
      metadata: { userId },
    };
    if (couponId) {
      params.discounts = [{ coupon: couponId }];
    }
    const session = await this.getClient().checkout.sessions.create(params);
    return session.url!;
  }

  async createSeatCheckoutSession(customerId: string, priceId: string, seatCount: number, orgId: string): Promise<string> {
    const session = await this.getClient().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: Math.max(3, seatCount) }],
      mode: 'subscription',
      subscription_data: {
        metadata: { orgId, billingModel: 'per_seat' },
      },
      success_url: `${config.APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.APP_URL}/pricing`,
      metadata: { orgId, billingModel: 'per_seat' },
    });
    return session.url!;
  }

  async updateSeatQuantity(subscriptionId: string, itemId: string, newCount: number): Promise<void> {
    await this.getClient().subscriptions.update(subscriptionId, {
      items: [{ id: itemId, quantity: Math.max(3, newCount) }],
      proration_behavior: 'create_prorations',
    });
  }

  async createTopUpSession(customerId: string, userId: string, quantity: number): Promise<string> {
    const priceId = config.STRIPE_TOPUP_PRICE_ID;
    if (!priceId) {
      throw new Error('STRIPE_TOPUP_PRICE_ID is not configured');
    }

    const session = await this.getClient().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity }],
      mode: 'payment',
      metadata: { userId, type: 'token_topup', quantity: String(quantity) },
      success_url: `${config.APP_URL}/settings?topup=success`,
      cancel_url: `${config.APP_URL}/settings?topup=canceled`,
    });
    return session.url!;
  }

  async createBillingPortalSession(customerId: string): Promise<string> {
    const session = await this.getClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${config.APP_URL}/dashboard`,
    });
    return session.url;
  }

  async handleWebhookEvent(payload: Buffer, signature: string): Promise<void> {
    const stripe = this.getClient();
    const event = stripe.webhooks.constructEvent(payload, signature, config.STRIPE_WEBHOOK_SECRET);

    const stripeEventId = event.id;

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.upsertSubscription(subscription, stripeEventId);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription, stripeEventId);
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          await this.upsertSubscription(subscription, stripeEventId);
        } else if (session.mode === 'payment' && session.metadata?.type === 'token_topup') {
          await this.handleTopUpCompleted(session, stripeEventId);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const subId = invoice.subscription as string | undefined;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          const customerId = subscription.customer as string;
          const user = await this.userService.findByStripeCustomerId(customerId);
          if (user) {
            subscriptionEventRepository.create(
              user.id, 'payment_failed', null, null,
              invoice.amount_due ?? null, stripeEventId,
              { invoiceId: invoice.id },
            ).catch(e => logger.error('[StripeService] Failed to log payment_failed event', e));
          }
          await this.upsertSubscription(subscription, stripeEventId);
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as any;
        const subId = invoice.subscription as string | undefined;
        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          const customerId = subscription.customer as string;
          const user = await this.userService.findByStripeCustomerId(customerId);
          if (user) {
            subscriptionEventRepository.create(
              user.id, 'payment_succeeded', null, null,
              invoice.amount_paid ?? null, stripeEventId,
              { invoiceId: invoice.id },
            ).catch(e => logger.error('[StripeService] Failed to log payment_succeeded event', e));
          }
          await this.upsertSubscription(subscription, stripeEventId);
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await this.handleRefund(charge, stripeEventId);
        break;
      }
      default:
        logger.info(`[StripeService] Unhandled event type: ${event.type}`);
    }
  }

  private async handleRefund(charge: Stripe.Charge, stripeEventId: string): Promise<void> {
    const customerId = charge.customer as string;
    if (!customerId) return;

    const user = await this.userService.findByStripeCustomerId(customerId);
    if (!user) {
      logger.warn(`[StripeService] No user found for refunded charge customer ${customerId}`);
      return;
    }

    // Increment refund count and revoke founder badge
    await databaseService.queryControlPlane(
      'UPDATE users SET refund_count = refund_count + 1, is_founder = FALSE, founder_at = NULL WHERE id = ?',
      [user.id],
    );

    // Log the refund event
    subscriptionEventRepository.create(
      user.id, 'refund_processed', user.subscriptionTier, null,
      charge.amount_refunded ?? null, stripeEventId,
      { chargeId: charge.id, refundCount: (user.refundCount || 0) + 1 },
    ).catch(e => logger.error('[StripeService] Failed to log refund event', e));

    // Flag abuse if multiple refunds
    if ((user.refundCount || 0) + 1 > 1) {
      logger.warn(`[StripeService] ABUSE FLAG: User ${user.id} has ${(user.refundCount || 0) + 1} refunds`);
      auditLedgerService.append({
        actorId: user.id,
        actorType: 'system',
        action: 'refund.abuse_flag',
        entityType: 'user',
        entityId: user.id,
        payload: { refundCount: (user.refundCount || 0) + 1 },
        source: 'system',
      }).catch(() => {});
    }

    logger.info(`[StripeService] Refund processed for user ${user.id}, charge ${charge.id}`);
  }

  async getSubscriptionStatus(userId: string): Promise<{
    tier: string;
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    isFounder: boolean;
  }> {
    const user = await this.userService.findById(userId);
    if (!user) throw new Error('User not found');

    const sub = await subscriptionRepository.findLatestByUser(userId);
    const isAdmin = user.role === 'admin';
    return {
      tier: isAdmin ? 'enterprise' : user.subscriptionTier,
      status: isAdmin ? 'active' : user.subscriptionStatus,
      trialEndsAt: user.trialEndsAt,
      currentPeriodEnd: sub ? sub.current_period_end : null,
      cancelAtPeriodEnd: sub ? Boolean(sub.cancel_at_period_end) : false,
      isFounder: user.isFounder,
    };
  }

  private async handleTopUpCompleted(session: Stripe.Checkout.Session, stripeEventId: string): Promise<void> {
    const userId = session.metadata?.userId;
    const quantity = parseInt(session.metadata?.quantity || '1', 10);
    if (!userId) {
      logger.error('[StripeService] Top-up session missing userId metadata');
      return;
    }

    // Prevent double-processing
    const existing = await tokenTopUpRepository.findByStripeSession(session.id);
    if (existing) return;

    const tokensPerPack = config.AI_TOPUP_TOKENS;
    const totalTokens = tokensPerPack * quantity;
    const totalCents = config.AI_TOPUP_PRICE_CENTS * quantity;

    await tokenTopUpRepository.create(userId, totalTokens, totalCents, session.id);
    logger.info(`[StripeService] Top-up credited: ${totalTokens} tokens for user ${userId}`);

    subscriptionEventRepository.create(
      userId, 'topup_purchased', null, null, totalCents, stripeEventId,
      { tokens: totalTokens, quantity },
    ).catch(e => logger.error('[StripeService] Failed to log topup_purchased event', e));
  }

  private resolveTierFromPriceId(priceId: string | undefined): 'trial' | 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise' {
    if (!priceId) return 'trial';

    // Consultant Basic price IDs
    const consultantBasicPriceIds = [
      config.STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID,
      config.STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID,
    ].filter(Boolean);
    if (consultantBasicPriceIds.includes(priceId)) return 'consultant_basic';

    // Consultant Pro price IDs (includes legacy consultant/pro IDs)
    const consultantProPriceIds = [
      config.STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID,
      config.STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID,
      // Legacy price IDs map to consultant_pro
      config.STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID,
      config.STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID,
      config.STRIPE_PRO_MONTHLY_PRICE_ID,
      config.STRIPE_PRO_ANNUAL_PRICE_ID,
    ].filter(Boolean);
    if (consultantProPriceIds.includes(priceId)) return 'consultant_pro';

    const smePriceIds = [
      config.STRIPE_SME_MONTHLY_PRICE_ID,
      config.STRIPE_SME_ANNUAL_PRICE_ID,
      config.STRIPE_SME_SEAT_MONTHLY_PRICE_ID,
      config.STRIPE_SME_SEAT_ANNUAL_PRICE_ID,
      // Legacy business price IDs map to sme
      config.STRIPE_BUSINESS_MONTHLY_PRICE_ID,
      config.STRIPE_BUSINESS_ANNUAL_PRICE_ID,
    ].filter(Boolean);
    if (smePriceIds.includes(priceId)) return 'sme';

    const enterprisePriceIds = [
      config.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID,
      config.STRIPE_ENTERPRISE_ANNUAL_PRICE_ID,
      // Legacy consultant price IDs map to enterprise
      config.STRIPE_CONSULTANT_MONTHLY_PRICE_ID,
      config.STRIPE_CONSULTANT_ANNUAL_PRICE_ID,
      // Legacy single-plan price IDs map to enterprise
      config.STRIPE_MONTHLY_PRICE_ID,
      config.STRIPE_ANNUAL_PRICE_ID,
      config.STRIPE_PRO_PRICE_ID,
    ].filter(Boolean);
    if (enterprisePriceIds.includes(priceId)) return 'enterprise';

    return 'trial';
  }

  private async upsertSubscription(subscription: Stripe.Subscription, stripeEventId: string): Promise<void> {
    const customerId = subscription.customer as string;
    const metadata = subscription.metadata || {};

    // Check if this is an org-level per-seat subscription
    if (metadata.billingModel === 'per_seat' && metadata.orgId) {
      await this.upsertOrgSubscription(subscription, stripeEventId, metadata.orgId);
      return;
    }

    // Also check if this customer belongs to an org (fallback for existing org subscriptions)
    const org = await organizationRepository.findByStripeCustomerId(customerId);
    if (org && org.billingModel === 'per_seat') {
      await this.upsertOrgSubscription(subscription, stripeEventId, org.id);
      return;
    }

    // Standard user-level subscription flow
    const user = await this.userService.findByStripeCustomerId(customerId);
    if (!user) {
      logger.error(`[StripeService] No user found for Stripe customer ${customerId}`);
      return;
    }

    // Determine tier from price ID
    const item = subscription.items.data[0];
    const priceId = item?.price?.id;
    const tier = this.resolveTierFromPriceId(priceId);
    const previousTier = user.subscriptionTier || 'trial';

    // Extract revenue data
    const amountCents = item?.price?.unit_amount ?? null;
    const currency = item?.price?.currency ?? 'usd';
    const interval = item?.price?.recurring?.interval as 'month' | 'year' | undefined;

    // Map Stripe status
    const status = this.mapStripeStatus(subscription.status);

    // In Stripe SDK v20+, period dates are on subscription items
    const sub = subscription as any;
    const periodStart = item?.current_period_start ?? sub.current_period_start;
    const periodEnd = item?.current_period_end ?? sub.current_period_end;

    // Update user
    await this.userService.update(user.id, {
      subscriptionTier: tier,
      subscriptionStatus: status,
      trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    });

    // Upsert subscription record
    const existing = await subscriptionRepository.findByStripeId(subscription.id);

    if (existing) {
      await subscriptionRepository.update(
        subscription.id,
        subscription.status,
        new Date(periodStart * 1000),
        new Date(periodEnd * 1000),
        subscription.cancel_at_period_end,
        subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      );

      // Log tier change event if tier actually changed
      if (previousTier !== tier) {
        subscriptionEventRepository.create(
          user.id, 'tier_changed', previousTier, tier, amountCents, stripeEventId,
        ).catch(e => logger.error('[StripeService] Failed to log tier_changed event', e));
      }
    } else {
      await subscriptionRepository.insert(
        uuidv4(),
        user.id,
        subscription.id,
        priceId || '',
        subscription.status,
        new Date(periodStart * 1000),
        new Date(periodEnd * 1000),
        subscription.cancel_at_period_end,
        subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      );

      // Log subscription created event
      subscriptionEventRepository.create(
        user.id, 'subscription_created', previousTier, tier, amountCents, stripeEventId,
      ).catch(e => logger.error('[StripeService] Failed to log subscription_created event', e));

      // Grant founder badge for launch-period Pro annual subscribers
      if (config.LAUNCH_OFFER_ENABLED && tier === 'consultant_pro' && interval === 'year') {
        this.userService.update(user.id, {
          isFounder: true,
          founderAt: new Date(),
        }).catch(e => logger.error('[StripeService] Failed to set founder badge', e));
      }
    }

    // Update revenue columns
    if (amountCents != null && interval) {
      subscriptionRepository.updateRevenueColumns(
        subscription.id, amountCents, currency, interval,
      ).catch(e => logger.error('[StripeService] Failed to update revenue columns', e));
    }

    // Fire-and-forget audit entry
    auditLedgerService.append({
      actorId: user.id,
      actorType: 'system',
      action: 'subscription.updated',
      entityType: 'subscription',
      entityId: subscription.id,
      payload: { tier, status, amountCents, interval },
      source: 'system',
    }).catch(e => logger.error('[StripeService] Failed to append audit entry', e));
  }

  private mapStripeStatus(stripeStatus: string): 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none' {
    const statusMap: Record<string, 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none'> = {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'canceled',
      incomplete: 'incomplete',
      incomplete_expired: 'none',
      unpaid: 'past_due',
    };
    return statusMap[stripeStatus] || 'none';
  }

  private async upsertOrgSubscription(subscription: Stripe.Subscription, stripeEventId: string, orgId: string): Promise<void> {
    const org = await organizationRepository.findById(orgId);
    if (!org) {
      logger.error(`[StripeService] No org found for orgId ${orgId}`);
      return;
    }

    const item = subscription.items.data[0];
    const priceId = item?.price?.id;
    const tier = this.resolveTierFromPriceId(priceId);
    const status = this.mapStripeStatus(subscription.status);
    const seatCount = item?.quantity ?? org.seatCount;
    const amountCents = item?.price?.unit_amount ?? null;
    const currency = item?.price?.currency ?? 'usd';
    const interval = item?.price?.recurring?.interval as 'month' | 'year' | undefined;
    const previousTier = org.subscriptionTier || 'trial';

    // Update organization record
    await organizationRepository.update(orgId, {
      subscriptionTier: tier,
      subscriptionStatus: status,
      billingModel: 'per_seat',
      seatCount,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionItemId: item?.id ?? null,
      viewerLimit: 999999,
    });

    // Sync all non-viewer users in org to this tier/status
    await databaseService.queryControlPlane(
      "UPDATE users SET subscription_tier = ?, subscription_status = ? WHERE organization_id = ? AND role != 'viewer'",
      [tier, status, orgId],
    );

    // Log event using org owner
    const ownerId = org.ownerUserId;
    if (previousTier !== tier) {
      subscriptionEventRepository.create(
        ownerId, 'tier_changed', previousTier, tier, amountCents ? amountCents * seatCount : null, stripeEventId,
        { billingModel: 'per_seat', seatCount },
      ).catch(e => logger.error('[StripeService] Failed to log org tier_changed event', e));
    } else {
      subscriptionEventRepository.create(
        ownerId, 'subscription_created', previousTier, tier, amountCents ? amountCents * seatCount : null, stripeEventId,
        { billingModel: 'per_seat', seatCount },
      ).catch(e => logger.error('[StripeService] Failed to log org subscription_created event', e));
    }

    // Revenue tracking — use total amount (unit_amount * quantity)
    if (amountCents != null && interval) {
      const existing = await subscriptionRepository.findByStripeId(subscription.id);
      const sub = subscription as any;
      const periodStart = item?.current_period_start ?? sub.current_period_start;
      const periodEnd = item?.current_period_end ?? sub.current_period_end;

      if (existing) {
        await subscriptionRepository.update(
          subscription.id, subscription.status,
          new Date(periodStart * 1000), new Date(periodEnd * 1000),
          subscription.cancel_at_period_end,
          subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
          subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        );
      } else {
        await subscriptionRepository.insert(
          uuidv4(), ownerId, subscription.id, priceId || '',
          subscription.status,
          new Date(periodStart * 1000), new Date(periodEnd * 1000),
          subscription.cancel_at_period_end,
          subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
          subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        );
      }

      subscriptionRepository.updateRevenueColumns(
        subscription.id, amountCents * seatCount, currency, interval,
      ).catch(e => logger.error('[StripeService] Failed to update org revenue columns', e));
    }

    auditLedgerService.append({
      actorId: ownerId, actorType: 'system',
      action: 'subscription.org_updated', entityType: 'organization', entityId: orgId,
      payload: { tier, status, seatCount, billingModel: 'per_seat' },
      source: 'system',
    }).catch(e => logger.error('[StripeService] Failed to append org audit entry', e));

    logger.info(`[StripeService] Org ${orgId} subscription updated: tier=${tier}, seats=${seatCount}, status=${status}`);
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription, stripeEventId: string): Promise<void> {
    const customerId = subscription.customer as string;
    const metadata = subscription.metadata || {};

    // Check if org-level subscription
    if (metadata.billingModel === 'per_seat' && metadata.orgId) {
      await this.handleOrgSubscriptionDeleted(subscription, stripeEventId, metadata.orgId);
      return;
    }

    const org = await organizationRepository.findByStripeCustomerId(customerId);
    if (org && org.billingModel === 'per_seat') {
      await this.handleOrgSubscriptionDeleted(subscription, stripeEventId, org.id);
      return;
    }

    const user = await this.userService.findByStripeCustomerId(customerId);
    if (!user) return;

    const previousTier = user.subscriptionTier || 'trial';

    await this.userService.update(user.id, {
      subscriptionTier: 'trial',
      subscriptionStatus: 'canceled',
    });

    await subscriptionRepository.markCanceled(subscription.id);

    subscriptionEventRepository.create(
      user.id, 'subscription_canceled', previousTier, 'trial', null, stripeEventId,
    ).catch(e => logger.error('[StripeService] Failed to log subscription_canceled event', e));

    auditLedgerService.append({
      actorId: user.id,
      actorType: 'system',
      action: 'subscription.canceled',
      entityType: 'subscription',
      entityId: subscription.id,
      payload: { previousTier },
      source: 'system',
    }).catch(e => logger.error('[StripeService] Failed to append audit entry', e));
  }

  private async handleOrgSubscriptionDeleted(subscription: Stripe.Subscription, stripeEventId: string, orgId: string): Promise<void> {
    const org = await organizationRepository.findById(orgId);
    if (!org) return;

    const previousTier = org.subscriptionTier || 'trial';

    await organizationRepository.update(orgId, {
      subscriptionTier: 'trial',
      subscriptionStatus: 'canceled',
      stripeSubscriptionId: null as any,
      stripeSubscriptionItemId: null as any,
    });

    // Downgrade all non-viewer users in org
    await databaseService.queryControlPlane(
      "UPDATE users SET subscription_tier = 'trial', subscription_status = 'canceled' WHERE organization_id = ? AND role != 'viewer'",
      [orgId],
    );

    await subscriptionRepository.markCanceled(subscription.id);

    subscriptionEventRepository.create(
      org.ownerUserId, 'subscription_canceled', previousTier, 'trial', null, stripeEventId,
      { billingModel: 'per_seat', orgId },
    ).catch(e => logger.error('[StripeService] Failed to log org subscription_canceled event', e));

    logger.info(`[StripeService] Org ${orgId} subscription canceled, all users downgraded to trial`);
  }
  async cancelAllSubscriptions(stripeCustomerId: string): Promise<void> {
    if (!this.stripe) return;
    const subscriptions = await this.stripe.subscriptions.list({ customer: stripeCustomerId, status: 'active' });
    for (const sub of subscriptions.data) {
      await this.stripe.subscriptions.cancel(sub.id);
    }
    const trialing = await this.stripe.subscriptions.list({ customer: stripeCustomerId, status: 'trialing' });
    for (const sub of trialing.data) {
      await this.stripe.subscriptions.cancel(sub.id);
    }
  }
}

export const stripeService = new StripeService();
