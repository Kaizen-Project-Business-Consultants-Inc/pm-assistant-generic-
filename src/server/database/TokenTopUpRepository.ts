import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export interface TokenTopUp {
  id: string;
  user_id: string;
  tokens_purchased: number;
  tokens_remaining: number;
  amount_cents: number;
  stripe_session_id: string | null;
  purchased_at: Date;
  expires_at: Date | null;
}

class TokenTopUpRepository {
  async getRemainingTokens(userId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane<{ total: number }>(
      `SELECT COALESCE(SUM(tokens_remaining), 0) AS total
       FROM token_top_ups
       WHERE user_id = ? AND tokens_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId],
    );
    return Number(rows[0]?.total || 0);
  }

  async getActiveTopUps(userId: string): Promise<TokenTopUp[]> {
    return databaseService.queryControlPlane<TokenTopUp>(
      `SELECT * FROM token_top_ups
       WHERE user_id = ? AND tokens_remaining > 0
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY purchased_at ASC`,
      [userId],
    );
  }

  async create(userId: string, tokensPurchased: number, amountCents: number, stripeSessionId: string | null): Promise<TokenTopUp> {
    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO token_top_ups (id, user_id, tokens_purchased, tokens_remaining, amount_cents, stripe_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, tokensPurchased, tokensPurchased, amountCents, stripeSessionId],
    );
    const rows = await databaseService.queryControlPlane<TokenTopUp>(
      'SELECT * FROM token_top_ups WHERE id = ?',
      [id],
    );
    return rows[0];
  }

  async consumeTokens(userId: string, tokensToConsume: number): Promise<void> {
    // Consume from oldest top-ups first (FIFO)
    const topUps = await this.getActiveTopUps(userId);
    let remaining = tokensToConsume;

    for (const topUp of topUps) {
      if (remaining <= 0) break;
      const consume = Math.min(remaining, topUp.tokens_remaining);
      // eslint-disable-next-line no-await-in-loop -- FIFO: draws down the oldest top-up first and stops once the amount is covered; a user holds only a few
      await databaseService.queryControlPlane(
        'UPDATE token_top_ups SET tokens_remaining = tokens_remaining - ? WHERE id = ?',
        [consume, topUp.id],
      );
      remaining -= consume;
    }
  }

  async findByStripeSession(sessionId: string): Promise<TokenTopUp | null> {
    const rows = await databaseService.queryControlPlane<TokenTopUp>(
      'SELECT * FROM token_top_ups WHERE stripe_session_id = ?',
      [sessionId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async getPurchaseHistory(userId: string, limit = 20): Promise<TokenTopUp[]> {
    return databaseService.queryControlPlane<TokenTopUp>(
      `SELECT * FROM token_top_ups WHERE user_id = ? ORDER BY purchased_at DESC LIMIT ?`,
      [userId, limit],
    );
  }
}

export const tokenTopUpRepository = new TokenTopUpRepository();
