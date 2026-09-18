import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (available inside vi.mock factories) ──────────────

const {
  mockConfig,
  mockStripeCustomersCreate,
  mockStripeCheckoutSessionsCreate,
  mockStripeBillingPortalSessionsCreate,
  mockStripeSubscriptionsRetrieve,
  mockStripeSubscriptionsUpdate,
  mockStripeSubscriptionsList,
  mockStripeSubscriptionsCancel,
  mockStripeWebhooksConstructEvent,
  mockFindByStripeCustomerId,
  mockFindById,
  mockUserUpdate,
} = vi.hoisted(() => {
  const mockConfig: Record<string, any> = {
    STRIPE_SECRET_KEY: 'sk_test_fake',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_TOPUP_PRICE_ID: 'price_topup',
    APP_URL: 'https://app.test',
    AI_TOPUP_TOKENS: 500000,
    AI_TOPUP_PRICE_CENTS: 1000,
    LAUNCH_OFFER_ENABLED: false,
    STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID: 'price_cb_mo',
    STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID: 'price_cb_yr',
    STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID: 'price_cp_mo',
    STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID: 'price_cp_yr',
    STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID: '',
    STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID: '',
    STRIPE_PRO_MONTHLY_PRICE_ID: '',
    STRIPE_PRO_ANNUAL_PRICE_ID: '',
    STRIPE_SME_MONTHLY_PRICE_ID: 'price_sme_mo',
    STRIPE_SME_ANNUAL_PRICE_ID: 'price_sme_yr',
    STRIPE_SME_SEAT_MONTHLY_PRICE_ID: 'price_sme_seat_mo',
    STRIPE_SME_SEAT_ANNUAL_PRICE_ID: '',
    STRIPE_BUSINESS_MONTHLY_PRICE_ID: '',
    STRIPE_BUSINESS_ANNUAL_PRICE_ID: '',
    STRIPE_ENTERPRISE_MONTHLY_PRICE_ID: 'price_ent_mo',
    STRIPE_ENTERPRISE_ANNUAL_PRICE_ID: 'price_ent_yr',
    STRIPE_CONSULTANT_MONTHLY_PRICE_ID: '',
    STRIPE_CONSULTANT_ANNUAL_PRICE_ID: '',
    STRIPE_MONTHLY_PRICE_ID: '',
    STRIPE_ANNUAL_PRICE_ID: '',
    STRIPE_PRO_PRICE_ID: '',
  };

  return {
    mockConfig,
    mockStripeCustomersCreate: vi.fn(),
    mockStripeCheckoutSessionsCreate: vi.fn(),
    mockStripeBillingPortalSessionsCreate: vi.fn(),
    mockStripeSubscriptionsRetrieve: vi.fn(),
    mockStripeSubscriptionsUpdate: vi.fn(),
    mockStripeSubscriptionsList: vi.fn(),
    mockStripeSubscriptionsCancel: vi.fn(),
    mockStripeWebhooksConstructEvent: vi.fn(),
    mockFindByStripeCustomerId: vi.fn(),
    mockFindById: vi.fn(),
    mockUserUpdate: vi.fn(),
  };
});

vi.mock('../../config', () => ({
  config: new Proxy({} as Record<string, any>, {
    get(_target, prop: string) {
      return mockConfig[prop];
    },
    set(_target, prop: string, value: any) {
      mockConfig[prop] = value;
      return true;
    },
  }),
}));

vi.mock('stripe', () => {
  return {
    default: class FakeStripe {
      customers = { create: mockStripeCustomersCreate };
      checkout = { sessions: { create: mockStripeCheckoutSessionsCreate } };
      billingPortal = { sessions: { create: mockStripeBillingPortalSessionsCreate } };
      subscriptions = {
        retrieve: mockStripeSubscriptionsRetrieve,
        update: mockStripeSubscriptionsUpdate,
        list: mockStripeSubscriptionsList,
        cancel: mockStripeSubscriptionsCancel,
      };
      webhooks = { constructEvent: mockStripeWebhooksConstructEvent };
    },
  };
});

vi.mock('../../services/UserService', () => ({
  UserService: class {
    findByStripeCustomerId = mockFindByStripeCustomerId;
    findById = mockFindById;
    update = mockUserUpdate;
  },
}));

vi.mock('../../database/SubscriptionRepository', () => ({
  subscriptionRepository: {
    findLatestByUser: vi.fn(),
    findByStripeId: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    updateRevenueColumns: vi.fn().mockResolvedValue(undefined),
    markCanceled: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/TokenTopUpRepository', () => ({
  tokenTopUpRepository: {
    findByStripeSession: vi.fn(),
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/SubscriptionEventRepository', () => ({
  subscriptionEventRepository: {
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: {
    findByStripeCustomerId: vi.fn(),
    findById: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    append: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { StripeService } from '../../services/StripeService';
import { subscriptionRepository } from '../../database/SubscriptionRepository';
import { tokenTopUpRepository } from '../../database/TokenTopUpRepository';
import { subscriptionEventRepository } from '../../database/SubscriptionEventRepository';
import { organizationRepository } from '../../database/OrganizationRepository';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';

// ── Helpers ─────────────────────────────────────────────────────────

function makeSubscription(overrides: Record<string, any> = {}): any {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    items: {
      data: [{
        id: 'si_123',
        price: { id: 'price_cp_mo', unit_amount: 2900, currency: 'usd', recurring: { interval: 'month' } },
        quantity: 1,
        current_period_start: 1700000000,
        current_period_end: 1702592000,
      }],
    },
    metadata: {},
    cancel_at_period_end: false,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    ...overrides,
  };
}

function makeUser(overrides: Record<string, any> = {}): any {
  return {
    id: 'user-1',
    email: 'test@test.com',
    role: 'user',
    subscriptionTier: 'trial',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_123',
    trialEndsAt: null,
    isFounder: false,
    refundCount: 0,
    ...overrides,
  };
}

function makeOrg(overrides: Record<string, any> = {}): any {
  return {
    id: 'org-1',
    ownerUserId: 'user-1',
    subscriptionTier: 'trial',
    subscriptionStatus: 'active',
    billingModel: 'per_seat',
    seatCount: 5,
    stripeCustomerId: 'cus_org',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to defaults
    mockConfig.STRIPE_SECRET_KEY = 'sk_test_fake';
    mockConfig.LAUNCH_OFFER_ENABLED = false;
    service = new StripeService();
  });

  // ── isConfigured ────────────────────────────────────────────────

  describe('isConfigured', () => {
    it('returns true when STRIPE_SECRET_KEY is set', () => {
      expect(service.isConfigured).toBe(true);
    });

    it('returns false when STRIPE_SECRET_KEY is empty', () => {
      mockConfig.STRIPE_SECRET_KEY = '';
      expect(service.isConfigured).toBe(false);
    });
  });

  // ── createCustomer ──────────────────────────────────────────────

  describe('createCustomer', () => {
    it('creates a Stripe customer and returns the id', async () => {
      mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new' });
      const result = await service.createCustomer('a@b.com', 'Alice', 'u1');
      expect(result).toBe('cus_new');
      expect(mockStripeCustomersCreate).toHaveBeenCalledWith({
        email: 'a@b.com',
        name: 'Alice',
        metadata: { userId: 'u1' },
      });
    });

    it('returns null when Stripe is not configured', async () => {
      mockConfig.STRIPE_SECRET_KEY = '';
      const result = await service.createCustomer('a@b.com', 'Alice', 'u1');
      expect(result).toBeNull();
      expect(mockStripeCustomersCreate).not.toHaveBeenCalled();
    });
  });

  // ── createCheckoutSession ───────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('creates a subscription checkout session and returns the URL', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/sess' });
      const url = await service.createCheckoutSession('cus_1', 'price_1', 'u1');
      expect(url).toBe('https://checkout.stripe.com/sess');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.customer).toBe('cus_1');
      expect(params.mode).toBe('subscription');
      expect(params.success_url).toContain('/dashboard');
    });

    it('uses custom successPath if provided', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/sess' });
      await service.createCheckoutSession('cus_1', 'price_1', 'u1', '/onboarding');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.success_url).toContain('/onboarding');
    });

    it('includes discounts when couponId is provided', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/sess' });
      await service.createCheckoutSession('cus_1', 'price_1', 'u1', undefined, 'coupon_abc');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.discounts).toEqual([{ coupon: 'coupon_abc' }]);
    });

    it('does not include discounts when couponId is not provided', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/sess' });
      await service.createCheckoutSession('cus_1', 'price_1', 'u1');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.discounts).toBeUndefined();
    });
  });

  // ── createSeatCheckoutSession ───────────────────────────────────

  describe('createSeatCheckoutSession', () => {
    it('creates a seat-based checkout session with minimum 3 seats', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/seat' });
      const url = await service.createSeatCheckoutSession('cus_1', 'price_sme', 1, 'org-1');
      expect(url).toBe('https://checkout.stripe.com/seat');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.line_items[0].quantity).toBe(3); // min 3
      expect(params.metadata.orgId).toBe('org-1');
      expect(params.metadata.billingModel).toBe('per_seat');
    });

    it('uses actual count when greater than 3', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/seat' });
      await service.createSeatCheckoutSession('cus_1', 'price_sme', 7, 'org-1');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.line_items[0].quantity).toBe(7);
    });
  });

  // ── updateSeatQuantity ──────────────────────────────────────────

  describe('updateSeatQuantity', () => {
    it('updates subscription with minimum 3 seats and proration', async () => {
      mockStripeSubscriptionsUpdate.mockResolvedValue({});
      await service.updateSeatQuantity('sub_1', 'si_1', 2);
      expect(mockStripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
        items: [{ id: 'si_1', quantity: 3 }],
        proration_behavior: 'create_prorations',
      });
    });

    it('uses actual count when greater than 3', async () => {
      mockStripeSubscriptionsUpdate.mockResolvedValue({});
      await service.updateSeatQuantity('sub_1', 'si_1', 10);
      expect(mockStripeSubscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
        items: [{ id: 'si_1', quantity: 10 }],
        proration_behavior: 'create_prorations',
      });
    });
  });

  // ── createTopUpSession ──────────────────────────────────────────

  describe('createTopUpSession', () => {
    it('creates a payment-mode session for token top-up', async () => {
      mockStripeCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/topup' });
      const url = await service.createTopUpSession('cus_1', 'u1', 3);
      expect(url).toBe('https://checkout.stripe.com/topup');
      const params = mockStripeCheckoutSessionsCreate.mock.calls[0][0];
      expect(params.mode).toBe('payment');
      expect(params.line_items[0].quantity).toBe(3);
      expect(params.metadata.type).toBe('token_topup');
    });

    it('throws if STRIPE_TOPUP_PRICE_ID is not configured', async () => {
      mockConfig.STRIPE_TOPUP_PRICE_ID = '';
      await expect(service.createTopUpSession('cus_1', 'u1', 1))
        .rejects.toThrow('STRIPE_TOPUP_PRICE_ID is not configured');
    });
  });

  // ── createBillingPortalSession ──────────────────────────────────

  describe('createBillingPortalSession', () => {
    it('creates a billing portal session and returns the URL', async () => {
      mockStripeBillingPortalSessionsCreate.mockResolvedValue({ url: 'https://billing.stripe.com/portal' });
      const url = await service.createBillingPortalSession('cus_1');
      expect(url).toBe('https://billing.stripe.com/portal');
      expect(mockStripeBillingPortalSessionsCreate).toHaveBeenCalledWith({
        customer: 'cus_1',
        return_url: 'https://app.test/dashboard',
      });
    });
  });

  // ── getSubscriptionStatus ───────────────────────────────────────

  describe('getSubscriptionStatus', () => {
    it('returns user subscription status', async () => {
      mockFindById.mockResolvedValue(makeUser({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active' }));
      (subscriptionRepository.findLatestByUser as any).mockResolvedValue({
        current_period_end: new Date('2026-12-31'),
        cancel_at_period_end: false,
      });

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.tier).toBe('consultant_pro');
      expect(result.status).toBe('active');
      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(result.isFounder).toBe(false);
    });

    it('returns enterprise tier for admin users regardless of actual tier', async () => {
      mockFindById.mockResolvedValue(makeUser({ role: 'admin', subscriptionTier: 'trial' }));
      (subscriptionRepository.findLatestByUser as any).mockResolvedValue(null);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.tier).toBe('enterprise');
      expect(result.status).toBe('active');
    });

    it('throws if user is not found', async () => {
      mockFindById.mockResolvedValue(null);
      await expect(service.getSubscriptionStatus('nonexistent')).rejects.toThrow('User not found');
    });

    it('returns null period end when no subscription record exists', async () => {
      mockFindById.mockResolvedValue(makeUser());
      (subscriptionRepository.findLatestByUser as any).mockResolvedValue(null);

      const result = await service.getSubscriptionStatus('user-1');
      expect(result.currentPeriodEnd).toBeNull();
      expect(result.cancelAtPeriodEnd).toBe(false);
    });
  });

  // ── handleWebhookEvent ──────────────────────────────────────────

  describe('handleWebhookEvent', () => {
    const payload = Buffer.from('test');
    const signature = 'sig_test';

    // --- customer.subscription.created / updated ---

    describe('customer.subscription.created/updated', () => {
      it('upserts a new user-level subscription (insert path)', async () => {
        const sub = makeSubscription();
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_1', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(mockUserUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
          subscriptionTier: 'consultant_pro',
          subscriptionStatus: 'active',
        }));
        expect(subscriptionRepository.insert).toHaveBeenCalled();
        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'subscription_created', 'trial', 'consultant_pro', 2900, 'evt_1',
        );
      });

      it('upserts an existing user-level subscription (update path)', async () => {
        const sub = makeSubscription();
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_2', type: 'customer.subscription.updated', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser({ subscriptionTier: 'consultant_basic' }));
        (subscriptionRepository.findByStripeId as any).mockResolvedValue({ id: 'existing' });
        (subscriptionRepository.update as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(subscriptionRepository.update).toHaveBeenCalled();
        // tier changed from consultant_basic to consultant_pro
        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'tier_changed', 'consultant_basic', 'consultant_pro', 2900, 'evt_2',
        );
      });

      it('does not log tier_changed if tier is same on update', async () => {
        const sub = makeSubscription();
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_3', type: 'customer.subscription.updated', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser({ subscriptionTier: 'consultant_pro' }));
        (subscriptionRepository.findByStripeId as any).mockResolvedValue({ id: 'existing' });
        (subscriptionRepository.update as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(subscriptionEventRepository.create).not.toHaveBeenCalled();
      });

      it('returns early when no user found for customer', async () => {
        const sub = makeSubscription();
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_4', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(null);

        await service.handleWebhookEvent(payload, signature);

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No user found'));
      });

      it('routes to org subscription when metadata has per_seat billingModel', async () => {
        const sub = makeSubscription({
          metadata: { billingModel: 'per_seat', orgId: 'org-1' },
          items: { data: [{ id: 'si_1', price: { id: 'price_sme_mo', unit_amount: 3300, currency: 'usd', recurring: { interval: 'month' } }, quantity: 5, current_period_start: 1700000000, current_period_end: 1702592000 }] },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_5', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findById as any).mockResolvedValue(makeOrg());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(organizationRepository.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
          subscriptionTier: 'sme',
          billingModel: 'per_seat',
          seatCount: 5,
          // Paying clears the trial: a subscriber never carries a trial date.
          trialEndsAt: null,
        }));
        const [sql, params] = (databaseService.queryControlPlane as any).mock.calls.find(
          (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE users'),
        );
        expect(sql).toContain('subscription_tier = ?');
        expect(sql).toContain('trial_ends_at = NULL');
        expect(sql).toContain('pending_tier = NULL');
        expect(params).toEqual(['sme', 'active', 'org-1']);
      });

      it('routes to org subscription via customer lookup fallback', async () => {
        const sub = makeSubscription({ customer: 'cus_org' });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_6', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(makeOrg());
        (organizationRepository.findById as any).mockResolvedValue(makeOrg());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(organizationRepository.update).toHaveBeenCalled();
      });

      it('grants founder badge for launch-period Pro annual subscribers (new sub)', async () => {
        mockConfig.LAUNCH_OFFER_ENABLED = true;
        const sub = makeSubscription({
          items: { data: [{ id: 'si_1', price: { id: 'price_cp_yr', unit_amount: 29900, currency: 'usd', recurring: { interval: 'year' } }, quantity: 1, current_period_start: 1700000000, current_period_end: 1702592000 }] },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_7', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        mockUserUpdate.mockResolvedValue(undefined);
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        // founder badge set (second call to update)
        expect(mockUserUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
          isFounder: true,
        }));
      });

      it('does NOT grant founder badge when LAUNCH_OFFER_ENABLED is false', async () => {
        mockConfig.LAUNCH_OFFER_ENABLED = false;
        const sub = makeSubscription({
          items: { data: [{ id: 'si_1', price: { id: 'price_cp_yr', unit_amount: 29900, currency: 'usd', recurring: { interval: 'year' } }, quantity: 1, current_period_start: 1700000000, current_period_end: 1702592000 }] },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_8', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        // Only one call to update (tier/status), no founder badge
        expect(mockUserUpdate).toHaveBeenCalledTimes(1);
        expect(mockUserUpdate).not.toHaveBeenCalledWith('user-1', expect.objectContaining({ isFounder: true }));
      });
    });

    // --- customer.subscription.deleted ---

    describe('customer.subscription.deleted', () => {
      it('downgrades user to trial on subscription deletion', async () => {
        const sub = makeSubscription({ status: 'canceled' });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_del_1', type: 'customer.subscription.deleted', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser({ subscriptionTier: 'consultant_pro' }));

        await service.handleWebhookEvent(payload, signature);

        expect(mockUserUpdate).toHaveBeenCalledWith('user-1', {
          subscriptionTier: 'trial',
          subscriptionStatus: 'canceled',
        });
        expect(subscriptionRepository.markCanceled).toHaveBeenCalledWith('sub_123');
        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'subscription_canceled', 'consultant_pro', 'trial', null, 'evt_del_1',
        );
      });

      it('returns early when user not found on deletion', async () => {
        const sub = makeSubscription();
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_del_2', type: 'customer.subscription.deleted', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(null);

        await service.handleWebhookEvent(payload, signature);

        expect(mockUserUpdate).not.toHaveBeenCalled();
      });

      it('downgrades org subscription on deletion via metadata', async () => {
        const sub = makeSubscription({
          metadata: { billingModel: 'per_seat', orgId: 'org-1' },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_del_3', type: 'customer.subscription.deleted', data: { object: sub },
        });
        (organizationRepository.findById as any).mockResolvedValue(makeOrg({ subscriptionTier: 'sme' }));

        await service.handleWebhookEvent(payload, signature);

        expect(organizationRepository.update).toHaveBeenCalledWith('org-1', expect.objectContaining({
          subscriptionTier: 'trial',
          subscriptionStatus: 'canceled',
        }));
        expect(databaseService.queryControlPlane).toHaveBeenCalledWith(
          expect.stringContaining("subscription_tier = 'trial'"),
          ['org-1'],
        );
        expect(subscriptionRepository.markCanceled).toHaveBeenCalledWith('sub_123');
      });

      it('returns early when org not found on org deletion', async () => {
        const sub = makeSubscription({
          metadata: { billingModel: 'per_seat', orgId: 'org-missing' },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_del_4', type: 'customer.subscription.deleted', data: { object: sub },
        });
        (organizationRepository.findById as any).mockResolvedValue(null);

        await service.handleWebhookEvent(payload, signature);

        expect(organizationRepository.update).not.toHaveBeenCalled();
      });
    });

    // --- checkout.session.completed ---

    describe('checkout.session.completed', () => {
      it('retrieves and upserts subscription for subscription-mode checkout', async () => {
        const session = { mode: 'subscription', subscription: 'sub_new', metadata: {} };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_cs_1', type: 'checkout.session.completed', data: { object: session },
        });
        const sub = makeSubscription({ id: 'sub_new' });
        mockStripeSubscriptionsRetrieve.mockResolvedValue(sub);
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(mockStripeSubscriptionsRetrieve).toHaveBeenCalledWith('sub_new');
        expect(subscriptionRepository.insert).toHaveBeenCalled();
      });

      it('handles token top-up checkout completion', async () => {
        const session = {
          id: 'cs_topup',
          mode: 'payment',
          subscription: null,
          metadata: { type: 'token_topup', userId: 'user-1', quantity: '2' },
        };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_cs_2', type: 'checkout.session.completed', data: { object: session },
        });
        (tokenTopUpRepository.findByStripeSession as any).mockResolvedValue(null);

        await service.handleWebhookEvent(payload, signature);

        expect(tokenTopUpRepository.create).toHaveBeenCalledWith(
          'user-1', 1000000, 2000, 'cs_topup', // 500000 * 2, 1000 * 2
        );
        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'topup_purchased', null, null, 2000, 'evt_cs_2',
          { tokens: 1000000, quantity: 2 },
        );
      });

      it('prevents double-processing of top-up', async () => {
        const session = {
          id: 'cs_topup_dup',
          mode: 'payment',
          subscription: null,
          metadata: { type: 'token_topup', userId: 'user-1', quantity: '1' },
        };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_cs_3', type: 'checkout.session.completed', data: { object: session },
        });
        (tokenTopUpRepository.findByStripeSession as any).mockResolvedValue({ id: 'existing' });

        await service.handleWebhookEvent(payload, signature);

        expect(tokenTopUpRepository.create).not.toHaveBeenCalled();
      });

      it('returns early for top-up with missing userId', async () => {
        const session = {
          id: 'cs_topup_no_user',
          mode: 'payment',
          subscription: null,
          metadata: { type: 'token_topup' },
        };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_cs_4', type: 'checkout.session.completed', data: { object: session },
        });

        await service.handleWebhookEvent(payload, signature);

        expect(tokenTopUpRepository.create).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('missing userId'));
      });
    });

    // --- invoice.payment_failed ---

    describe('invoice.payment_failed', () => {
      it('logs payment_failed event and upserts subscription', async () => {
        const invoice = { id: 'inv_1', subscription: 'sub_123', amount_due: 2900 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_pf_1', type: 'invoice.payment_failed', data: { object: invoice },
        });
        const sub = makeSubscription({ status: 'past_due' });
        mockStripeSubscriptionsRetrieve.mockResolvedValue(sub);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        (subscriptionRepository.findByStripeId as any).mockResolvedValue({ id: 'existing' });
        (subscriptionRepository.update as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'payment_failed', null, null, 2900, 'evt_pf_1',
          { invoiceId: 'inv_1' },
        );
      });

      it('skips when invoice has no subscription id', async () => {
        const invoice = { id: 'inv_2', amount_due: 100 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_pf_2', type: 'invoice.payment_failed', data: { object: invoice },
        });

        await service.handleWebhookEvent(payload, signature);

        expect(mockStripeSubscriptionsRetrieve).not.toHaveBeenCalled();
      });
    });

    // --- invoice.paid ---

    describe('invoice.paid', () => {
      it('logs payment_succeeded event and upserts subscription', async () => {
        const invoice = { id: 'inv_3', subscription: 'sub_123', amount_paid: 2900 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ip_1', type: 'invoice.paid', data: { object: invoice },
        });
        const sub = makeSubscription();
        mockStripeSubscriptionsRetrieve.mockResolvedValue(sub);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        (subscriptionRepository.findByStripeId as any).mockResolvedValue({ id: 'existing' });
        (subscriptionRepository.update as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(payload, signature);

        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'payment_succeeded', null, null, 2900, 'evt_ip_1',
          { invoiceId: 'inv_3' },
        );
      });

      it('skips when invoice has no subscription id', async () => {
        const invoice = { id: 'inv_4', amount_paid: 100 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ip_2', type: 'invoice.paid', data: { object: invoice },
        });

        await service.handleWebhookEvent(payload, signature);

        expect(mockStripeSubscriptionsRetrieve).not.toHaveBeenCalled();
      });
    });

    // --- charge.refunded ---

    describe('charge.refunded', () => {
      it('increments refund count and revokes founder badge', async () => {
        const charge = { id: 'ch_1', customer: 'cus_123', amount_refunded: 2900 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ref_1', type: 'charge.refunded', data: { object: charge },
        });
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());

        await service.handleWebhookEvent(payload, signature);

        expect(databaseService.queryControlPlane).toHaveBeenCalledWith(
          expect.stringContaining('refund_count = refund_count + 1'),
          ['user-1'],
        );
        expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
          'user-1', 'refund_processed', 'trial', null,
          2900, 'evt_ref_1',
          { chargeId: 'ch_1', refundCount: 1 },
        );
      });

      it('flags abuse when refund count exceeds 1', async () => {
        const charge = { id: 'ch_2', customer: 'cus_123', amount_refunded: 2900 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ref_2', type: 'charge.refunded', data: { object: charge },
        });
        mockFindByStripeCustomerId.mockResolvedValue(makeUser({ refundCount: 1 }));

        await service.handleWebhookEvent(payload, signature);

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ABUSE FLAG'));
        expect(auditLedgerService.append).toHaveBeenCalledWith(expect.objectContaining({
          action: 'refund.abuse_flag',
        }));
      });

      it('does not flag abuse for first refund', async () => {
        const charge = { id: 'ch_3', customer: 'cus_123', amount_refunded: 2900 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ref_3', type: 'charge.refunded', data: { object: charge },
        });
        mockFindByStripeCustomerId.mockResolvedValue(makeUser({ refundCount: 0 }));

        await service.handleWebhookEvent(payload, signature);

        expect(auditLedgerService.append).not.toHaveBeenCalledWith(expect.objectContaining({
          action: 'refund.abuse_flag',
        }));
      });

      it('returns early when no customer on charge', async () => {
        const charge = { id: 'ch_4', customer: null, amount_refunded: 100 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ref_4', type: 'charge.refunded', data: { object: charge },
        });

        await service.handleWebhookEvent(payload, signature);

        expect(mockFindByStripeCustomerId).not.toHaveBeenCalled();
      });

      it('returns early when no user found for customer', async () => {
        const charge = { id: 'ch_5', customer: 'cus_unknown', amount_refunded: 100 };
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_ref_5', type: 'charge.refunded', data: { object: charge },
        });
        mockFindByStripeCustomerId.mockResolvedValue(null);

        await service.handleWebhookEvent(payload, signature);

        expect(databaseService.queryControlPlane).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No user found'));
      });
    });

    // --- unhandled event type ---

    describe('unhandled event types', () => {
      it('logs unhandled event types', async () => {
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_unk', type: 'payment_intent.created', data: { object: {} },
        });

        await service.handleWebhookEvent(payload, signature);

        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Unhandled event type'));
      });
    });
  });

  // ── cancelAllSubscriptions ──────────────────────────────────────

  describe('cancelAllSubscriptions', () => {
    it('cancels all active and trialing subscriptions', async () => {
      // Need to trigger getClient first so this.stripe is set
      // cancelAllSubscriptions checks this.stripe directly
      mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_x' });
      await service.createCustomer('a@b.com', 'A', 'u1'); // initializes this.stripe

      mockStripeSubscriptionsList
        .mockResolvedValueOnce({ data: [{ id: 'sub_a1' }, { id: 'sub_a2' }] }) // active
        .mockResolvedValueOnce({ data: [{ id: 'sub_t1' }] }); // trialing
      mockStripeSubscriptionsCancel.mockResolvedValue({});

      await service.cancelAllSubscriptions('cus_123');

      expect(mockStripeSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_123', status: 'active' });
      expect(mockStripeSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_123', status: 'trialing' });
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledTimes(3);
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledWith('sub_a1');
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledWith('sub_a2');
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledWith('sub_t1');
    });

    it('does nothing when stripe client is not initialized', async () => {
      // Fresh service — this.stripe is null
      await service.cancelAllSubscriptions('cus_123');
      expect(mockStripeSubscriptionsList).not.toHaveBeenCalled();
    });
  });

  // ── resolveTierFromPriceId (tested indirectly) ──────────────────

  describe('tier resolution from price IDs', () => {
    function testTierResolution(priceId: string, expectedTier: string) {
      it(`resolves ${priceId} to ${expectedTier}`, async () => {
        const sub = makeSubscription({
          items: { data: [{ id: 'si_1', price: { id: priceId, unit_amount: 100, currency: 'usd', recurring: { interval: 'month' } }, quantity: 1, current_period_start: 1700000000, current_period_end: 1702592000 }] },
        });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_tier', type: 'customer.subscription.created', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
        (subscriptionRepository.insert as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(Buffer.from(''), 'sig');

        expect(mockUserUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
          subscriptionTier: expectedTier,
        }));
      });
    }

    testTierResolution('price_cb_mo', 'consultant_basic');
    testTierResolution('price_cb_yr', 'consultant_basic');
    testTierResolution('price_cp_mo', 'consultant_pro');
    testTierResolution('price_cp_yr', 'consultant_pro');
    testTierResolution('price_sme_mo', 'sme');
    testTierResolution('price_sme_yr', 'sme');
    testTierResolution('price_sme_seat_mo', 'sme');
    testTierResolution('price_ent_mo', 'enterprise');
    testTierResolution('price_ent_yr', 'enterprise');
    testTierResolution('price_unknown_xyz', 'trial'); // unknown -> trial fallback

    it('resolves undefined priceId to trial', async () => {
      const sub = makeSubscription({
        items: { data: [{ id: 'si_1', price: { id: undefined, unit_amount: null, currency: 'usd', recurring: null }, quantity: 1, current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      mockStripeWebhooksConstructEvent.mockReturnValue({
        id: 'evt_tier_nil', type: 'customer.subscription.created', data: { object: sub },
      });
      (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
      mockFindByStripeCustomerId.mockResolvedValue(makeUser());
      (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
      (subscriptionRepository.insert as any).mockResolvedValue(undefined);

      await service.handleWebhookEvent(Buffer.from(''), 'sig');

      expect(mockUserUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
        subscriptionTier: 'trial',
      }));
    });
  });

  // ── mapStripeStatus (tested indirectly) ─────────────────────────

  describe('status mapping', () => {
    function testStatusMapping(stripeStatus: string, expectedStatus: string) {
      it(`maps Stripe status '${stripeStatus}' to '${expectedStatus}'`, async () => {
        const sub = makeSubscription({ status: stripeStatus });
        mockStripeWebhooksConstructEvent.mockReturnValue({
          id: 'evt_status', type: 'customer.subscription.updated', data: { object: sub },
        });
        (organizationRepository.findByStripeCustomerId as any).mockResolvedValue(null);
        mockFindByStripeCustomerId.mockResolvedValue(makeUser());
        (subscriptionRepository.findByStripeId as any).mockResolvedValue({ id: 'existing' });
        (subscriptionRepository.update as any).mockResolvedValue(undefined);

        await service.handleWebhookEvent(Buffer.from(''), 'sig');

        expect(mockUserUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
          subscriptionStatus: expectedStatus,
        }));
      });
    }

    testStatusMapping('active', 'active');
    testStatusMapping('trialing', 'trialing');
    testStatusMapping('past_due', 'past_due');
    testStatusMapping('canceled', 'canceled');
    testStatusMapping('incomplete', 'incomplete');
    testStatusMapping('incomplete_expired', 'none');
    testStatusMapping('unpaid', 'past_due');
    testStatusMapping('some_unknown_status', 'none');
  });

  // ── org subscription (upsertOrgSubscription) ───────────────────

  describe('upsertOrgSubscription', () => {
    const buf = Buffer.from('test');
    const sig = 'sig_test';

    it('returns early when org not found', async () => {
      const sub = makeSubscription({
        metadata: { billingModel: 'per_seat', orgId: 'org-missing' },
      });
      mockStripeWebhooksConstructEvent.mockReturnValue({
        id: 'evt_org_1', type: 'customer.subscription.created', data: { object: sub },
      });
      (organizationRepository.findById as any).mockResolvedValue(null);

      await service.handleWebhookEvent(buf, sig);

      expect(organizationRepository.update).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('No org found'));
    });

    it('logs tier_changed when org tier changes', async () => {
      const sub = makeSubscription({
        metadata: { billingModel: 'per_seat', orgId: 'org-1' },
        items: { data: [{ id: 'si_1', price: { id: 'price_sme_mo', unit_amount: 3300, currency: 'usd', recurring: { interval: 'month' } }, quantity: 5, current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      mockStripeWebhooksConstructEvent.mockReturnValue({
        id: 'evt_org_2', type: 'customer.subscription.updated', data: { object: sub },
      });
      (organizationRepository.findById as any).mockResolvedValue(makeOrg({ subscriptionTier: 'trial' }));
      (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
      (subscriptionRepository.insert as any).mockResolvedValue(undefined);

      await service.handleWebhookEvent(buf, sig);

      expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
        'user-1', 'tier_changed', 'trial', 'sme',
        expect.any(Number), 'evt_org_2',
        expect.objectContaining({ billingModel: 'per_seat', seatCount: 5 }),
      );
    });

    it('logs subscription_created when org tier does not change', async () => {
      const sub = makeSubscription({
        metadata: { billingModel: 'per_seat', orgId: 'org-1' },
        items: { data: [{ id: 'si_1', price: { id: 'price_sme_mo', unit_amount: 3300, currency: 'usd', recurring: { interval: 'month' } }, quantity: 5, current_period_start: 1700000000, current_period_end: 1702592000 }] },
      });
      mockStripeWebhooksConstructEvent.mockReturnValue({
        id: 'evt_org_3', type: 'customer.subscription.created', data: { object: sub },
      });
      (organizationRepository.findById as any).mockResolvedValue(makeOrg({ subscriptionTier: 'sme' }));
      (subscriptionRepository.findByStripeId as any).mockResolvedValue(null);
      (subscriptionRepository.insert as any).mockResolvedValue(undefined);

      await service.handleWebhookEvent(buf, sig);

      expect(subscriptionEventRepository.create).toHaveBeenCalledWith(
        'user-1', 'subscription_created', 'sme', 'sme',
        expect.any(Number), 'evt_org_3',
        expect.objectContaining({ billingModel: 'per_seat' }),
      );
    });
  });
});
