import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export type SubscriptionEventType =
  | 'subscription_created'
  | 'tier_changed'
  | 'subscription_renewed'
  | 'subscription_canceled'
  | 'payment_failed'
  | 'payment_succeeded'
  | 'trial_started'
  | 'trial_expired'
  | 'topup_purchased'
  | 'refund_processed';

export interface SubscriptionEvent {
  id: string;
  user_id: string;
  event_type: SubscriptionEventType;
  previous_tier: string | null;
  new_tier: string | null;
  amount_cents: number | null;
  stripe_event_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

class SubscriptionEventRepository {
  async create(
    userId: string,
    eventType: SubscriptionEventType,
    previousTier: string | null,
    newTier: string | null,
    amountCents: number | null,
    stripeEventId: string | null,
    metadata: Record<string, unknown> | null = null,
  ): Promise<void> {
    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO subscription_events
        (id, user_id, event_type, previous_tier, new_tier, amount_cents, stripe_event_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, eventType, previousTier, newTier, amountCents, stripeEventId,
       metadata ? JSON.stringify(metadata) : null],
    );
  }

  async findByUser(userId: string, limit = 50): Promise<SubscriptionEvent[]> {
    return databaseService.queryControlPlane<SubscriptionEvent>(
      `SELECT * FROM subscription_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );
  }

  async getRecentGlobal(limit = 100, since?: string): Promise<SubscriptionEvent[]> {
    if (since) {
      return databaseService.queryControlPlane<SubscriptionEvent>(
        `SELECT se.*, u.full_name, u.email
         FROM subscription_events se
         LEFT JOIN users u ON u.id = se.user_id
         WHERE se.created_at >= ?
         ORDER BY se.created_at DESC LIMIT ?`,
        [since, limit],
      );
    }
    return databaseService.queryControlPlane<SubscriptionEvent>(
      `SELECT se.*, u.full_name, u.email
       FROM subscription_events se
       LEFT JOIN users u ON u.id = se.user_id
       ORDER BY se.created_at DESC LIMIT ?`,
      [limit],
    );
  }

  async getCountsByType(since: string): Promise<Record<string, number>> {
    const rows = await databaseService.queryControlPlane<{ event_type: string; cnt: number }>(
      `SELECT event_type, COUNT(*) AS cnt
       FROM subscription_events
       WHERE created_at >= ?
       GROUP BY event_type`,
      [since],
    );
    const result: Record<string, number> = {};
    for (const r of rows) {
      result[r.event_type] = Number(r.cnt);
    }
    return result;
  }

  async getMonthlyTrend(months = 12): Promise<Array<{ month: string; mrr_cents: number; topups_cents: number }>> {
    return databaseService.queryControlPlane(
      `SELECT
        DATE_FORMAT(created_at, '%Y-%m') AS month,
        COALESCE(SUM(CASE WHEN event_type IN ('subscription_created','tier_changed','subscription_renewed','payment_succeeded') THEN amount_cents ELSE 0 END), 0) AS mrr_cents,
        COALESCE(SUM(CASE WHEN event_type = 'topup_purchased' THEN amount_cents ELSE 0 END), 0) AS topups_cents
       FROM subscription_events
       WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month`,
      [months],
    );
  }
}

export const subscriptionEventRepository = new SubscriptionEventRepository();
