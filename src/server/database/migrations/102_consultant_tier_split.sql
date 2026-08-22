-- Migration 102: Split 'consultant' tier into 'consultant_basic' and 'consultant_pro'
-- Existing consultant users are grandfathered into consultant_pro.

-- Step 1: Expand users.subscription_tier ENUM to include new values
ALTER TABLE users MODIFY COLUMN subscription_tier
  ENUM('trial', 'consultant', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise')
  NOT NULL DEFAULT 'trial';

-- Step 2: Migrate existing consultant users to consultant_pro
UPDATE users SET subscription_tier = 'consultant_pro' WHERE subscription_tier = 'consultant';

-- Step 3: Remove old 'consultant' value from ENUM
ALTER TABLE users MODIFY COLUMN subscription_tier
  ENUM('trial', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise')
  NOT NULL DEFAULT 'trial';

-- Step 4: Same 3-step for organizations.subscription_tier
ALTER TABLE organizations MODIFY COLUMN subscription_tier
  ENUM('trial', 'consultant', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise')
  NOT NULL DEFAULT 'trial';

UPDATE organizations SET subscription_tier = 'consultant_pro' WHERE subscription_tier = 'consultant';

ALTER TABLE organizations MODIFY COLUMN subscription_tier
  ENUM('trial', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise')
  NOT NULL DEFAULT 'trial';

-- Step 5: Insert pricing_config rows for new tiers
INSERT INTO pricing_config (id, tier, display_name, monthly_price_cents, annual_price_cents, ai_tokens_monthly, ai_tokens_label, ai_tokens_description, storage_mb, storage_label, viewer_limit, viewer_limit_label, max_projects, is_per_seat, min_seats, duration_days, highlight, features_json, sort_order, is_active)
VALUES
  (UUID(), 'consultant_basic', 'Consultant Basic', 1900, 19000, 0, '---', 'Core PM features, no AI', 1024, '1GB', 5, '5', 0, 0, 1, 0, 0, '["Unlimited projects","Gantt, Kanban, Sprint boards","RAID management","All exports (CSV, PDF, XML)","API access & integrations","5 free viewer invites","Stakeholder portal"]', 1, 1),
  (UUID(), 'consultant_pro', 'Consultant Pro', 2900, 29000, 500000, '500K', '~100 AI chats, 50 risk scans, or 25 reports/mo', 1024, '1GB', 5, '5', 0, 0, 1, 0, 1, '["Everything in Basic, plus:","Mjuzi AI assistant (500K tokens/mo)","AI risk scans & forecasting","EVM dashboard & Monte Carlo","Meeting intelligence & voice","NL query engine","AI auto-reschedule","Token top-up packs"]', 2, 1);

-- Step 6: Deactivate old consultant pricing_config row
UPDATE pricing_config SET is_active = 0 WHERE tier = 'consultant';

-- Step 7: Insert tier_features rows for consultant_basic (exports, portal, api_keys enabled; AI features disabled)
INSERT IGNORE INTO tier_features (id, tier, feature_key, enabled)
SELECT UUID(), 'consultant_basic', feature_key,
  CASE
    WHEN feature_key IN ('exports', 'portal', 'api_keys') THEN 1
    ELSE 0
  END
FROM tier_features WHERE tier = 'consultant'
GROUP BY feature_key;

-- Step 8: Insert tier_features for consultant_pro (all features enabled)
INSERT IGNORE INTO tier_features (id, tier, feature_key, enabled)
SELECT UUID(), 'consultant_pro', feature_key, 1
FROM tier_features WHERE tier = 'consultant'
GROUP BY feature_key;
