-- Launch Offer: Founders badge + refund tracking
ALTER TABLE users
  ADD COLUMN is_founder BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_monthly_token_budget,
  ADD COLUMN founder_at DATETIME NULL AFTER is_founder,
  ADD COLUMN refund_count TINYINT NOT NULL DEFAULT 0 AFTER founder_at;

-- Add refund_processed event type
ALTER TABLE subscription_events
  MODIFY COLUMN event_type ENUM(
    'subscription_created','tier_changed','subscription_renewed',
    'subscription_canceled','payment_failed','payment_succeeded',
    'trial_started','trial_expired','topup_purchased',
    'refund_processed'
  ) NOT NULL;

INSERT INTO _migrations (name) VALUES ('103_launch_offer');
