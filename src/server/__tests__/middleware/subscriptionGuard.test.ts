import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const users = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));

import { subscriptionGuard } from '../../middleware/requireSubscription';

function makeReply() {
  const reply: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { reply.statusCode = code; return reply; },
    send(payload: any) { reply.body = payload; reply.sent = true; return reply; },
    sent: false,
  };
  return reply;
}

function makeRequest(over: Record<string, any> = {}) {
  return {
    method: 'POST',
    url: '/api/v1/projects',
    user: { userId: 'u1', role: 'project_manager' },
    ...over,
  } as any;
}

const future = new Date(Date.now() + 5 * 86400_000);
const past = new Date(Date.now() - 86400_000);

/**
 * The trial has to actually end.
 *
 * The per-route version of this was written in July and applied to nothing —
 * zero call sites — so an expired trial kept full write access indefinitely.
 * Proved on staging: an account whose trial ended the previous day created a
 * project without complaint.
 */
describe('the subscription guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks a write once the trial has ended', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'none', subscriptionTier: 'trial', trialEndsAt: past });
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body.message).toMatch(/trial has ended/i);
    expect(reply.body.upgradeUrl).toBe('/pricing');
  });

  it('never blocks reading — their own work is the reason to subscribe', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'none', subscriptionTier: 'trial', trialEndsAt: past });
    const reply = makeReply();

    await subscriptionGuard(makeRequest({ method: 'GET' }), reply);

    expect(reply.sent).toBe(false);
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('lets a trial still running write', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'trialing', subscriptionTier: 'trial', trialEndsAt: future });
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.sent).toBe(false);
  });

  it('lets a paying customer write', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'active', subscriptionTier: 'consultant_pro', trialEndsAt: null });
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.sent).toBe(false);
  });

  it('does not lock out a customer whose card just failed', async () => {
    // Stripe retries for days. Blocking mid-dunning loses a paying customer for
    // good, which is far worse than the revenue at stake.
    users.findById.mockResolvedValue({ subscriptionStatus: 'past_due', subscriptionTier: 'consultant_pro', trialEndsAt: null });
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.sent).toBe(false);
  });

  it('tells someone who never finished paying to finish, not that their trial ended', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'incomplete', subscriptionTier: 'trial', trialEndsAt: null, pendingTier: 'consultant_pro' });
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body.awaitingPayment).toBe(true);
    expect(reply.body.message).toMatch(/complete your subscription/i);
  });

  describe('what keeps working when the subscription is dead', () => {
    beforeEach(() => {
      users.findById.mockResolvedValue({ subscriptionStatus: 'none', subscriptionTier: 'trial', trialEndsAt: past });
    });

    it.each([
      ['/api/v1/auth/logout', 'signing out'],
      ['/api/v1/stripe/create-checkout-session', 'paying'],
      ['/api/v1/stripe/webhook', "Stripe's own callbacks"],
      ['/api/v1/seats/add', 'buying seats'],
      ['/api/v1/org/settings', 'managing the subscription'],
      ['/api/v1/users/me', 'your own profile'],
      ['/api/v1/notifications/read', 'not looking broken'],
      ['/api/v1/exports/project', 'taking your data with you'],
      ['/api/v1/feedback', 'telling us it is wrong'],
    ])('%s — %s', async (url) => {
      const reply = makeReply();
      await subscriptionGuard(makeRequest({ url }), reply);
      expect(reply.sent).toBe(false);
    });

    it('ignores the query string when matching', async () => {
      const reply = makeReply();
      await subscriptionGuard(makeRequest({ url: '/api/v1/stripe/create-checkout-session?tier=pro' }), reply);
      expect(reply.sent).toBe(false);
    });
  });

  it('leaves an unauthenticated request to the auth check', async () => {
    // Answering here would turn a 401 into a confusing 403.
    const reply = makeReply();
    await subscriptionGuard(makeRequest({ user: undefined }), reply);
    expect(reply.sent).toBe(false);
  });

  it('lets admins through', async () => {
    users.findById.mockResolvedValue({ subscriptionStatus: 'none', subscriptionTier: 'trial', trialEndsAt: past });
    const reply = makeReply();

    await subscriptionGuard(makeRequest({ user: { userId: 'a1', role: 'admin' } }), reply);

    expect(reply.sent).toBe(false);
  });

  it('fails open if the lookup breaks, rather than locking everyone out', async () => {
    users.findById.mockRejectedValue(new Error('control plane down'));
    const reply = makeReply();

    await subscriptionGuard(makeRequest(), reply);

    expect(reply.sent).toBe(false);
  });
});
