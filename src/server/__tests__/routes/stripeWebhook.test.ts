import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPii: (v: string) => v,
}));

vi.mock('../../config', () => ({
  config: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', APP_URL: 'https://x.test' },
}));

const svc = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  processWebhookEvent: vi.fn(),
}));

vi.mock('../../services/StripeService', () => ({
  stripeService: svc,
  StripeService: {
    HANDLED_EVENTS: new Set([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'checkout.session.completed',
      'invoice.payment_failed',
      'invoice.payment_succeeded',
    ]),
  },
}));

// The route file pulls in a good deal it does not need for this endpoint.
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async () => {}) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: {} }));
vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]), queryControlPlane: vi.fn().mockResolvedValue([]) },
}));

import { stripeRoutes } from '../../routes/integrations/stripe';

async function buildApp() {
  const app = Fastify();
  // Mimic the rawBody decoration the real server provides.
  app.addHook('preHandler', async (req: any) => {
    req.rawBody = Buffer.from(JSON.stringify(req.body ?? {}));
  });
  await app.register(stripeRoutes, { prefix: '/api/v1/stripe' });
  return app;
}

function post(app: any, body: unknown, headers: Record<string, string> = { 'stripe-signature': 'sig' }) {
  return app.inject({ method: 'POST', url: '/api/v1/stripe/webhook', headers, payload: body });
}

/**
 * Payment notifications are the moment money becomes access. Before this, every
 * failure — forged message, our own bug, database down — was logged as
 * {"name":"Error"} and answered 200, so Stripe never retried and the event was
 * lost. 16 of 54 deliveries in the 30 days to 2026-09-21 went that way.
 */
describe('the Stripe webhook', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('refuses a message it cannot prove came from Stripe', async () => {
    // Either someone is posting to our endpoint, or our secret is wrong. Both
    // need to be loud; 200 would hide both.
    svc.verifyWebhook.mockImplementation(() => { throw new Error('No signatures found matching the expected signature'); });

    const res = await post(app, { id: 'evt_1' });

    expect(res.statusCode).toBe(400);
    expect(svc.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects a message with no signature at all', async () => {
    const res = await post(app, { id: 'evt_1' }, {});
    expect(res.statusCode).toBe(400);
  });

  it('acknowledges events it has no opinion about, without processing them', async () => {
    // Stripe sends a great deal we do not act on; retrying those forever would
    // bury the ones that matter.
    svc.verifyWebhook.mockReturnValue({ id: 'evt_2', type: 'customer.created' });

    const res = await post(app, {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).handled).toBe(false);
    expect(svc.processWebhookEvent).not.toHaveBeenCalled();
  });

  it('processes a payment event and confirms it', async () => {
    svc.verifyWebhook.mockReturnValue({ id: 'evt_3', type: 'checkout.session.completed' });
    svc.processWebhookEvent.mockResolvedValue(undefined);

    const res = await post(app, {});

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).handled).toBe(true);
    expect(svc.processWebhookEvent).toHaveBeenCalledOnce();
  });

  it('asks Stripe to retry when a payment event could not be processed', async () => {
    // This is the whole point. A customer has been charged; if we answer 200 on
    // our own failure they never get access and nothing ever retries.
    svc.verifyWebhook.mockReturnValue({ id: 'evt_4', type: 'customer.subscription.created' });
    svc.processWebhookEvent.mockRejectedValue(new Error('database unavailable'));

    const res = await post(app, {});

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).eventId).toBe('evt_4');
  });

  it('records why it failed, not just that it did', async () => {
    const logger = (await import('../../utils/logger')).default as any;
    svc.verifyWebhook.mockReturnValue({ id: 'evt_5', type: 'invoice.payment_failed' });
    svc.processWebhookEvent.mockRejectedValue(new Error('customer not found'));

    await post(app, {});

    const logged = logger.error.mock.calls.at(-1)?.[1];
    // Logging the raw error object serialises to {"name":"Error"} — the exact
    // reason these failures went undiagnosed for a month.
    expect(logged.message).toBe('customer not found');
    expect(logged.eventId).toBe('evt_5');
    expect(logged.type).toBe('invoice.payment_failed');
  });
});
