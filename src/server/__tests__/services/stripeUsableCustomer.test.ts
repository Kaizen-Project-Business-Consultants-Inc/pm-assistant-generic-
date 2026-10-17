import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A Stripe customer deleted in the dashboard (the test sandbox was cleared, 2026-10-17) made checkout
 * fail with "No such customer"; one never stored sent people to support. Both now get a new customer.
 */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config', () => ({ config: { STRIPE_SECRET_KEY: 'sk_test' } }));

import { StripeService, PaymentsUnavailableError } from '../../services/StripeService';

const customers = { retrieve: vi.fn(), create: vi.fn() };
function service() {
  const s = new StripeService();
  (s as unknown as { stripe: unknown }).stripe = { customers };
  return s;
}
const missing = Object.assign(new Error('No such customer'), { code: 'resource_missing' });
const opts = (over: Partial<Parameters<StripeService['usableCustomer']>[0]> = {}) => ({
  storedId: 'cus_old' as string | null, email: 'a@x.test', name: 'A', userId: 'u1', ownerKey: 'user:u1', paying: false, save: vi.fn(), ...over,
});

describe('StripeService.usableCustomer', () => {
  beforeEach(() => { customers.retrieve.mockReset(); customers.create.mockReset().mockResolvedValue({ id: 'cus_new' }); });

  it('keeps a customer Stripe still has', async () => {
    customers.retrieve.mockResolvedValue({ id: 'cus_old' });
    const o = opts();
    expect(await service().usableCustomer(o)).toBe('cus_old');
    expect(customers.create).not.toHaveBeenCalled();
    expect(o.save).not.toHaveBeenCalled();
  });

  it.each([
    ['deleted in the dashboard', () => customers.retrieve.mockResolvedValue({ id: 'cus_old', deleted: true })],
    ['unknown to Stripe', () => customers.retrieve.mockRejectedValue(missing)],
  ])('replaces a customer %s and saves the new one', async (_label, arrange) => {
    arrange();
    const o = opts();
    expect(await service().usableCustomer(o)).toBe('cus_new');
    expect(o.save).toHaveBeenCalledWith('cus_new');
  });

  it('two clicks at once ask Stripe with the same idempotency key, so they get one customer', async () => {
    await service().usableCustomer(opts({ storedId: null }));
    await service().usableCustomer(opts({ storedId: null }));
    const keys = customers.create.mock.calls.map(c => c[1]?.idempotencyKey);
    expect(keys).toEqual(['customer:user:u1:none', 'customer:user:u1:none']);
  });

  it("a paying owner's missing customer is not swapped (wrong key/account, not a deletion)", async () => {
    customers.retrieve.mockRejectedValue(missing);
    await expect(service().usableCustomer(opts({ paying: true }))).rejects.toBeInstanceOf(PaymentsUnavailableError);
    expect(customers.create).not.toHaveBeenCalled();
  });

  it('a Stripe outage is not mistaken for a deleted customer', async () => {
    customers.retrieve.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'api_connection_error' }));
    await expect(service().usableCustomer(opts())).rejects.toBeInstanceOf(PaymentsUnavailableError);
    expect(customers.create).not.toHaveBeenCalled();
  });
});

describe('a subscription whose customer we no longer store', () => {
  function withUsers() {
    const s = service();
    const users = { findByStripeCustomerId: vi.fn(async () => null), findById: vi.fn(async () => ({ id: 'u1' })), update: vi.fn() };
    (s as unknown as { userService: unknown }).userService = users;
    const find = (sub: object) => (s as unknown as { userByCustomerOrMetadata: (x: object) => Promise<{ id: string } | null> }).userByCustomerOrMetadata(sub);
    return { users, find };
  }

  it('a live one is matched by the userId on it, and its customer is stored', async () => {
    const { users, find } = withUsers();
    expect((await find({ customer: 'cus_paid', status: 'active', metadata: { userId: 'u1' } }))?.id).toBe('u1');
    expect(users.update).toHaveBeenCalledWith('u1', { stripeCustomerId: 'cus_paid' });
  });

  it('a late event for an ended one matches nobody and changes nothing', async () => {
    const { users, find } = withUsers();
    expect(await find({ customer: 'cus_deleted', status: 'canceled', metadata: { userId: 'u1' } })).toBeNull();
    expect(users.update).not.toHaveBeenCalled();
  });
});
