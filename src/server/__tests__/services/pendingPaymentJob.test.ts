import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { queryControlPlane: vi.fn() },
}));
vi.mock('../../services/EmailService', () => ({
  emailService: { sendPendingPaymentEmail: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/StripeService', () => ({
  stripeService: { reconcileFromStripe: vi.fn() },
}));
vi.mock('../../services/RedisService', () => ({
  redisService: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runPendingPaymentSweep } from '../../services/scheduling/pendingPaymentJob';
import { databaseService } from '../../database/connection';
import { emailService } from '../../services/EmailService';
import { stripeService } from '../../services/StripeService';
import { redisService } from '../../services/RedisService';

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function pendingRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'u-1',
    email: 'someone@example.com',
    full_name: 'Someone',
    pending_tier: 'sme',
    created_at: daysAgo(3),
    ...overrides,
  };
}

describe('pendingPaymentJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (redisService.get as any).mockResolvedValue(null);
  });

  it('rescues an account that actually paid but whose webhook never arrived', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([pendingRow({ created_at: daysAgo(30) })]);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(true);

    const result = await runPendingPaymentSweep();

    expect(result.rescued).toBe(1);
    expect(result.purged).toBe(0);
    // A paying customer must never be chased or closed.
    expect(emailService.sendPendingPaymentEmail).not.toHaveBeenCalled();
  });

  it('never acts on an account it could not verify with Stripe', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([pendingRow({ created_at: daysAgo(30) })]);
    (stripeService.reconcileFromStripe as any).mockRejectedValue(new Error('stripe down'));

    const result = await runPendingPaymentSweep();

    expect(result).toEqual({ rescued: 0, reminded: 0, purged: 0 });
    expect(emailService.sendPendingPaymentEmail).not.toHaveBeenCalled();
  });

  it('sends one reminder to a genuinely unpaid signup', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([pendingRow()]);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(false);

    const result = await runPendingPaymentSweep();

    expect(result.reminded).toBe(1);
    expect(emailService.sendPendingPaymentEmail).toHaveBeenCalledWith('someone@example.com', 'Someone', 'sme');
    expect(redisService.set).toHaveBeenCalled();
  });

  it('does not send the reminder twice', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([pendingRow()]);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(false);
    (redisService.get as any).mockResolvedValue('1');

    const result = await runPendingPaymentSweep();

    expect(result.reminded).toBe(0);
    expect(emailService.sendPendingPaymentEmail).not.toHaveBeenCalled();
  });

  it('leaves a brand new signup alone', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([pendingRow({ created_at: daysAgo(0) })]);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(false);

    const result = await runPendingPaymentSweep();

    expect(result).toEqual({ rescued: 0, reminded: 0, purged: 0 });
  });

  it('closes an abandoned empty signup after two weeks', async () => {
    (databaseService.queryControlPlane as any)
      .mockResolvedValueOnce([pendingRow({ created_at: daysAgo(20) })])
      .mockResolvedValueOnce([{ n: 0 }])
      .mockResolvedValueOnce(undefined);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(false);

    const result = await runPendingPaymentSweep();

    expect(result.purged).toBe(1);
  });

  it('will not close an abandoned signup that already has a real workspace', async () => {
    (databaseService.queryControlPlane as any)
      .mockResolvedValueOnce([pendingRow({ created_at: daysAgo(20) })])
      .mockResolvedValueOnce([{ n: 1 }]);
    (stripeService.reconcileFromStripe as any).mockResolvedValue(false);

    const result = await runPendingPaymentSweep();

    expect(result.purged).toBe(0);
  });

  it('does nothing when no account is awaiting payment', async () => {
    (databaseService.queryControlPlane as any).mockResolvedValueOnce([]);

    const result = await runPendingPaymentSweep();

    expect(result).toEqual({ rescued: 0, reminded: 0, purged: 0 });
    expect(stripeService.reconcileFromStripe).not.toHaveBeenCalled();
  });
});
