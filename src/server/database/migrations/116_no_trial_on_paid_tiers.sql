-- No trial on paid tiers.
--
-- Rule: a trial belongs to the free tier only. The moment an account pays it is a
-- subscriber, and it carries no trial date. Someone who chose a paid plan but has
-- not paid yet is NOT a free-tier customer — they are an unpaid signup, held in the
-- existing 'incomplete' status until their payment confirms.
--
-- Background: registration used to stamp every new account with a 14-day trial
-- BEFORE it looked at which plan the person had chosen, and the per-seat (SME)
-- activation path never cleared that stamp. The flat-rate path did. So every SME
-- subscriber carried a stale trial date. It was dormant on a healthy row, but if the
-- Stripe confirmation was ever late or lost the nightly job saw a 'trialing' account
-- with a past trial date and downgraded a customer who had actually paid.

-- 1. Remember which plan an unpaid signup was trying to buy, so we can resume their
--    checkout and tell them what they were subscribing to. Deliberately NOT
--    subscription_tier: that column grants feature access, and an unpaid signup must
--    not receive the features of a plan they have not paid for.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_tier VARCHAR(32) NULL AFTER subscription_tier;

-- 2. Clear the stale trial stamp off every account that has already paid.
UPDATE users
   SET trial_ends_at = NULL, trial_started_at = NULL
 WHERE subscription_status = 'active'
   AND subscription_tier <> 'trial';

UPDATE organizations
   SET trial_ends_at = NULL
 WHERE subscription_status = 'active'
   AND subscription_tier <> 'trial';

-- 3. Backfill trial_started_at for genuine, still-running trials. The column was
--    added by migration 047 for "accurate trial tracking" and then never written by
--    any application code, so it is NULL everywhere. Registration now sets it.
UPDATE users
   SET trial_started_at = created_at
 WHERE trial_started_at IS NULL
   AND trial_ends_at IS NOT NULL
   AND subscription_tier = 'trial';
