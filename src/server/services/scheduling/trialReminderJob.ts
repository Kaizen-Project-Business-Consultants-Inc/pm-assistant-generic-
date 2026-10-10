import { databaseService } from '../../database/connection';
import { emailService } from '../EmailService';
import logger from '../../utils/logger';
import { keysAlreadySet } from '../../utils/redisKeysSet';
import { redisService } from '../RedisService';
import crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * People who signed up but never clicked the confirmation link. Their account isn't usable yet,
 * so they get a fresh link a day and three days after signing up rather than a trial countdown
 * (2026-10-10: 6 of the first 7 outside sign-ups never confirmed, and got a week of "your trial
 * ends" emails for a trial they never started). Paid-plan and invited sign-ups get it too, so
 * the wording never mentions a trial.
 */
async function sendConfirmEmailReminders(): Promise<void> {
  // Day 1 or day 3 is worked out by the database's own clock, the same one the window uses
  const rows = await databaseService.queryControlPlane(
    `SELECT id, email, TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 72 AS late
     FROM users
     WHERE email_verified = 0
       AND is_active = 1
       AND created_at <= DATE_SUB(NOW(), INTERVAL 1 DAY)
       AND created_at > DATE_SUB(NOW(), INTERVAL 4 DAY)
     LIMIT 500`,
  );
  if (rows.length === 0) return;

  const due = rows.map((row: any) => ({ row, key: `verify-reminder:${row.id}:${Number(row.late) ? '3day' : '1day'}` }));
  const alreadySent = await keysAlreadySet(due.map(d => d.key));

  for (const [i, { row, key }] of due.entries()) {
    if (alreadySent[i]) continue;
    try {
      // A fresh link: the first one lasted 24 hours, so it has run out by now
      const token = crypto.randomUUID();
      // eslint-disable-next-line no-await-in-loop -- each person gets their own link, saved before it is emailed
      await databaseService.queryControlPlane(
        'UPDATE users SET email_verification_token = ?, email_verification_expires = ? WHERE id = ? AND email_verified = 0',
        [token, new Date(Date.now() + DAY_MS), row.id],
      );
      // eslint-disable-next-line no-await-in-loop -- email provider sends go one by one (rate limits)
      await emailService.sendVerificationEmail(row.email, token, { reminder: true });
      // eslint-disable-next-line no-await-in-loop -- marks the reminder sent only after this person's email went out
      await redisService.set(key, '1', 30 * DAY_MS / 1000);
      logger.info(`[trial-reminder] Sent confirm-your-email reminder to ${row.id}`);
    } catch (err) {
      logger.error(`[trial-reminder] Failed to send confirm-your-email reminder to ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Sends trial reminder emails to users whose trial is ending soon (3 days, 1 day)
 * and a trial-expired email on the day the trial ends.
 *
 * Uses `digest_last_sent_at` pattern: tracks sent reminders via a simple
 * `trial_reminders_sent` JSON column to avoid duplicate emails.
 * For simplicity, we use a Redis key per user to track which reminders were sent.
 */
export async function runTrialReminders(): Promise<void> {
  try {
    // --- Step 1: Downgrade expired trials ---
    // Set subscription_status = 'none' for users whose trial has passed
    // Only free-tier trials are ever downgraded. The tier check is the safety catch:
    // without it, a paid account whose Stripe confirmation was late or lost still
    // looks like a plain expiring trial, and this query would lock out a customer who
    // had actually paid.
    const downgraded = await databaseService.queryControlPlane(
      `UPDATE users
       SET subscription_status = 'none'
       WHERE subscription_status = 'trialing'
         AND subscription_tier = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at < NOW()`,
    );
    const downgradedCount = (downgraded as any)?.affectedRows ?? 0;
    if (downgradedCount > 0) {
      logger.info(`[trial-reminder] Downgraded ${downgradedCount} expired trial users to 'none'`);
    }

    // Also downgrade organizations with expired trials
    const orgDowngraded = await databaseService.queryControlPlane(
      `UPDATE organizations
       SET subscription_status = 'none'
       WHERE subscription_status = 'trialing'
         AND subscription_tier = 'trial'
         AND stripe_subscription_id IS NULL
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at < NOW()`,
    );
    const orgCount = (orgDowngraded as any)?.affectedRows ?? 0;
    if (orgCount > 0) {
      logger.info(`[trial-reminder] Downgraded ${orgCount} expired trial orgs to 'none'`);
    }

    // --- Step 2: Nudge people who never confirmed their email ---
    // Its own catch: a fault here must not stop Step 3's countdown emails
    await sendConfirmEmailReminders().catch((err) => {
      logger.error('[trial-reminder] Confirm-your-email reminders failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // --- Step 3: Send reminder/expired emails ---
    // Find trialing users with trial ending in the next 3 days or already expired
    // Free-tier trials only. `subscription_tier = 'trial'` keeps these emails away
    // from paying customers — telling a subscriber their trial is expiring is both
    // alarming and wrong. The window reaches 8 days out for the first nudge.
    // Confirmed emails only: an unconfirmed account isn't usable yet, so a countdown
    // means nothing to them — they get Step 2's nudge instead (2026-10-10).
    const rows = await databaseService.queryControlPlane(
      `SELECT id, email, full_name, trial_ends_at, subscription_status
       FROM users
       WHERE subscription_status IN ('trialing', 'none')
         AND subscription_tier = 'trial'
         AND email_verified = 1
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
         AND trial_ends_at <= DATE_ADD(NOW(), INTERVAL 8 DAY)
       LIMIT 500`,
    );

    if (rows.length === 0) return;

    // Which reminder each person is due, worked out first so "already sent?" is one MGET for
    // everyone, not a GET per person (2026-10-09)
    const due: Array<{ row: any; daysLeft: number; reminderKey: string }> = [];
    for (const row of rows) {
      const trialEnd = new Date(row.trial_ends_at);
      const now = new Date();
      const msLeft = trialEnd.getTime() - now.getTime();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

      // Four touches: a week out (while they are still actively using it and have
      // time to get a budget approved), then 3 days, 1 day, and the day it ends.
      let reminderKey: string;
      if (daysLeft <= 0) {
        reminderKey = `trial-reminder:${row.id}:expired`;
      } else if (daysLeft <= 1) {
        reminderKey = `trial-reminder:${row.id}:1day`;
      } else if (daysLeft <= 3) {
        reminderKey = `trial-reminder:${row.id}:3day`;
      } else if (daysLeft <= 7) {
        reminderKey = `trial-reminder:${row.id}:7day`;
      } else {
        continue;
      }

      due.push({ row, daysLeft, reminderKey });
    }

    // Check if this reminder was already sent (Redis key with 30-day TTL)
    const alreadySent = await keysAlreadySet(due.map(d => d.reminderKey));

    for (const [i, { row, daysLeft, reminderKey }] of due.entries()) {
      if (alreadySent[i]) continue;

      try {
        const name = row.full_name || 'there';
        if (daysLeft <= 0) {
          // eslint-disable-next-line no-await-in-loop -- email provider sends go one by one (rate limits)
          await emailService.sendTrialExpiredEmail(row.email, name);
          logger.info(`[trial-reminder] Sent expired email to ${row.id}`);
        } else {
          // eslint-disable-next-line no-await-in-loop -- email provider sends go one by one (rate limits)
          await emailService.sendTrialReminderEmail(row.email, name, daysLeft);
          logger.info(`[trial-reminder] Sent ${daysLeft}-day reminder to ${row.id}`);
        }

        // Mark as sent (30-day TTL to auto-cleanup)
        // eslint-disable-next-line no-await-in-loop -- marks the reminder sent only after this user's email went out
        await redisService.set(reminderKey, '1', 30 * 24 * 60 * 60);
      } catch (err) {
        logger.error(`[trial-reminder] Failed to send email to ${row.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error('[trial-reminder] Job failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
