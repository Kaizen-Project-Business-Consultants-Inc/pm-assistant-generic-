import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn() },
}));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireActiveSubscription } from '../../middleware/requireSubscription';
import { userService } from '../../services/UserService';

function makeReply() {
  const reply: any = {
    statusCode: 0,
    body: null,
    status(code: number) { reply.statusCode = code; return reply; },
    send(body: any) { reply.body = body; return reply; },
  };
  return reply;
}

const req = (role = 'project_manager') => ({ user: { userId: 'u-1', role }, method: 'POST', url: '/api/v1/projects' }) as any;

const account = (over: Record<string, any> = {}) => ({
  id: 'u-1',
  subscriptionTier: 'trial',
  pendingTier: null,
  subscriptionStatus: 'none',
  trialEndsAt: null,
  ...over,
});

const inFuture = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
const inPast = () => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

describe('requireActiveSubscription', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a paying subscriber through', async () => {
    (userService.findById as any).mockResolvedValue(account({ subscriptionTier: 'sme', subscriptionStatus: 'active' }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(0);
  });

  it('lets a paying subscriber through even if a stale trial date is left on the record', async () => {
    // The bug this replaced: a paid SME account carried a registration trial stamp,
    // and an expired one must never strand a customer who has paid.
    (userService.findById as any).mockResolvedValue(account({
      subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: inPast(),
    }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(0);
  });

  it('lets a running free trial through', async () => {
    (userService.findById as any).mockResolvedValue(account({ subscriptionStatus: 'trialing', trialEndsAt: inFuture() }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(0);
  });

  it('blocks an expired free trial', async () => {
    (userService.findById as any).mockResolvedValue(account({ subscriptionStatus: 'trialing', trialEndsAt: inPast() }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body.message).toContain('trial has ended');
  });

  it('tells an unpaid signup to finish paying, not that a trial ended', async () => {
    (userService.findById as any).mockResolvedValue(account({ subscriptionStatus: 'incomplete', pendingTier: 'sme' }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body.awaitingPayment).toBe(true);
    expect(reply.body.pendingTier).toBe('sme');
    expect(reply.body.trialExpired).toBe(false);
    expect(reply.body.message).not.toContain('trial');
  });

  it('tells a cancelled subscriber their subscription ended', async () => {
    (userService.findById as any).mockResolvedValue(account({ subscriptionStatus: 'canceled' }));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body.message).toContain('subscription has ended');
  });

  it('never blocks an admin', async () => {
    const reply = makeReply();

    await requireActiveSubscription(req('admin'), reply);

    expect(reply.statusCode).toBe(0);
    expect(userService.findById).not.toHaveBeenCalled();
  });

  it('fails open if the lookup throws, rather than locking everyone out', async () => {
    (userService.findById as any).mockRejectedValue(new Error('db down'));
    const reply = makeReply();

    await requireActiveSubscription(req(), reply);

    expect(reply.statusCode).toBe(0);
  });
});
