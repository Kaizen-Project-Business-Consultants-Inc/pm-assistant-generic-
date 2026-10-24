-- A company's own AI allowance (C1, 2026-10-23).
--
-- A per-seat company shares ONE monthly pool of AI tokens (seats x the plan's per-seat allowance).
-- The per-person override on users.ai_monthly_token_budget never applied to it, so the only lever
-- was the plan-wide number, which changes every company on that plan. This is the owner's lever for
-- one company: when set, it replaces the plan pool for that company only (NULL = the plan default).
-- Set from Admin > Companies; the two audit columns say who changed it and when.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ai_allowance_override BIGINT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_allowance_override_by VARCHAR(36) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_allowance_override_at DATETIME NULL DEFAULT NULL;

-- The daily spike alert asks "who spent the most on this feature today": feature AND time range.
ALTER TABLE ai_usage_log ADD INDEX IF NOT EXISTS idx_ai_usage_feature_created (feature, created_at);
