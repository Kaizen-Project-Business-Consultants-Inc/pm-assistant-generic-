import { ApiBase } from './http';

/**
 * Stripe checkout, subscription, seats, top-ups and AI budget.
 * Mixed into the one `apiService` (see ../api.ts); `this.api` is the shared axios instance.
 */
export interface TopUpBalance {
  /** Purchased AI tokens left (not expired), summed over the signed-in user's packs */
  remainingTopUpTokens: number;
  topUpConfig: { tokensPerPack: number; pricePerPack: number };
  history: Array<{ id: string; tokensPurchased: number; tokensRemaining: number; amountCents: number; purchasedAt: string; expiresAt: string | null }>;
}

export class BillingApi extends ApiBase {
  // -------------------------------------------------------------------------
  // Stripe / Subscription endpoints
  // -------------------------------------------------------------------------

  async createCheckoutSession(plan: 'monthly' | 'annual' = 'monthly', tier: string = 'consultant_pro', seats?: number) {
    const response = await this.api.post('/stripe/create-checkout-session', { plan, tier, ...(seats != null && { seats }) });
    return response.data;
  }

  async getSeatInfo(): Promise<{ usedSeats: number; paidSeats: number; availableSeats: number; billingModel: string; seatPriceCents: number }> {
    const response = await this.api.get('/seats');
    return response.data;
  }

  async addSeats(count: number): Promise<{ paidSeats: number; message: string }> {
    const response = await this.api.post('/seats/add', { count });
    return response.data;
  }

  async removeSeats(count: number): Promise<{ paidSeats: number; message: string }> {
    const response = await this.api.post('/seats/remove', { count });
    return response.data;
  }

  async createTopUpSession(quantity: number = 1) {
    const response = await this.api.post('/stripe/create-topup-session', { quantity });
    return response.data;
  }

  /** GET /stripe/topup-balance (routes/integrations/stripe.ts; keys camelCased by the server) — the fields the app uses */
  async getTopUpBalance(): Promise<TopUpBalance> {
    const response = await this.api.get('/stripe/topup-balance');
    return response.data;
  }

  async getAiBudget(): Promise<{
    totalInputTokens: number; totalOutputTokens: number; totalTokens: number;
    totalCost: number; requestCount: number; budget: number; remaining: number; percentUsed: number;
  }> {
    const response = await this.api.get('/ai/budget');
    return response.data;
  }

  async createPortalSession() {
    const response = await this.api.post('/stripe/create-portal-session');
    return response.data;
  }

  async getSubscriptionStatus() {
    const response = await this.api.get('/stripe/subscription-status');
    return response.data;
  }

  /** Re-check this account's subscription directly with Stripe, bypassing the webhook. */
  async reconcileSubscription() {
    const response = await this.api.post('/stripe/reconcile');
    return response.data;
  }
}
