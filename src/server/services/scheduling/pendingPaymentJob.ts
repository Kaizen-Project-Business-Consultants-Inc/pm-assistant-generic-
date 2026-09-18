import { databaseService } from '../../database/connection';
import { emailService } from '../EmailService';
import { stripeService } from '../StripeService';
import logger from '../../utils/logger';

/**
 * Looks after accounts stuck in 'incomplete' — people who chose a paid plan but whose
 * payment has not confirmed.
 *
 * Two jobs, in this order:
 *
 * 1. RESCUE. Ask Stripe directly whether they actually paid. The webhook is the normal
 *    path but it can be late, dropped, or fail, and a customer who paid while we never
 *    heard about it is the worst state in the system — they are locked out of
 *    something they bought. This sweep is the backstop behind the check that already
 *    runs when they return from the payment page.
 *
 * 2. CHASE, then let go. Anyone genuinely unpaid gets one reminder, and their empty
 *    account is removed after PURGE_AFTER_DAYS so abandoned signups do not accumulate
 *    forever. Only ever removes accounts that own nothing.
 */

const REMIND_AFTER_DAYS = 2;
const PURGE_AFTER_DAYS = 14;

export async function runPendingPaymentSweep(): Promise<{ rescued: number; reminded: number; purged: number }> {
  const result = { rescued: 0, reminded: 0, purged: 0 };

  try {
    const pending = await databaseService.queryControlPlane(
      `SELECT id, email, full_name, pending_tier, created_at
         FROM users
        WHERE subscription_status = 'incomplete'
          AND is_active = 1
        LIMIT 500`,
    ) as Array<{ id: string; email: string; full_name: string | null; pending_tier: string | null; created_at: string }>;

    if (pending.length === 0) return result;

    const { redisService } = await import('../RedisService');
    const now = Date.now();

    for (const row of pending) {
      // --- 1. Rescue: did they actually pay? ---
      try {
        const paid = await stripeService.reconcileFromStripe(row.id);
        if (paid) {
          result.rescued++;
          logger.warn('[pending-payment] Recovered a paid account that the webhook missed', { userId: row.id });
          continue;
        }
      } catch (err) {
        logger.error('[pending-payment] Reconcile failed', {
          userId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Never act on an account we could not verify with Stripe.
        continue;
      }

      const ageDays = (now - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000);

      // --- 2a. Chase once ---
      if (ageDays >= REMIND_AFTER_DAYS && ageDays < PURGE_AFTER_DAYS) {
        const key = `pending-payment-reminded:${row.id}`;
        if (!(await redisService.get(key))) {
          try {
            await emailService.sendPendingPaymentEmail(row.email, row.full_name || 'there', row.pending_tier);
            await redisService.set(key, '1', 30 * 24 * 60 * 60);
            result.reminded++;
          } catch (err) {
            logger.error('[pending-payment] Reminder email failed', {
              userId: row.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        continue;
      }

      // --- 2b. Let go of an abandoned, empty signup ---
      if (ageDays >= PURGE_AFTER_DAYS) {
        const [owned] = await databaseService.queryControlPlane(
          'SELECT COUNT(*) AS n FROM organizations WHERE owner_user_id = ? AND is_provisioned = 1',
          [row.id],
        ) as Array<{ n: number }>;
        if (Number(owned?.n ?? 0) > 0) {
          // They got as far as a real workspace — leave it alone and let a human decide.
          continue;
        }

        await databaseService.queryControlPlane(
          'UPDATE users SET is_active = 0 WHERE id = ? AND subscription_status = \'incomplete\'',
          [row.id],
        );
        result.purged++;
        logger.info('[pending-payment] Deactivated abandoned unpaid signup', { userId: row.id, ageDays: Math.round(ageDays) });
      }
    }

    if (result.rescued || result.reminded || result.purged) {
      logger.info('[pending-payment] Sweep complete', result);
    }
  } catch (err) {
    logger.error('[pending-payment] Job failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
}
