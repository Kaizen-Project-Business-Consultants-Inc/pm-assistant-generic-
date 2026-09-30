-- Migration 123 (2026-09-30): the last gaps in the plan tables.
--
-- 1. The Enterprise plan's price row was only ever added by hand on production (15 Sep), so
--    every other database (staging, the test bed, a rebuild) had no Enterprise plan: its
--    users got no AI allowance and no viewer limit. Same values as production's row.
-- 2. "ai_assistant" gates Import from a document (AI) but was never in any plan's feature
--    list, so it was refused on every plan. On for the plans that include AI; off for
--    Consultant Basic (no AI). Trial has a small AI allowance to try it out.
--
-- INSERT IGNORE: rows that already exist (production's Enterprise row, any deliberate
-- setting) are left exactly as they are.
INSERT IGNORE INTO pricing_config (id, tier, display_name, monthly_price_cents, annual_price_cents,
  ai_tokens_monthly, ai_tokens_label, ai_tokens_description, storage_mb, storage_label,
  viewer_limit, viewer_limit_label, max_projects, is_per_seat, min_seats, duration_days,
  highlight, features_json, sort_order, is_active)
VALUES (UUID(), 'enterprise', 'Enterprise', 7900, 79000, 5000000, '5M', 'Full AI capacity for large organizations',
  10240, '10GB', 999999, 'Unlimited', 0, 0, 1, 0, 0,
  '["Everything in SME, plus:","5M AI tokens/month","10GB file storage","Unlimited viewer invites","Priority support","Custom integrations","Dedicated account manager"]',
  4, 1);

INSERT IGNORE INTO tier_features (id, tier, feature_key, enabled) VALUES
  (UUID(), 'trial', 'ai_assistant', 1),
  (UUID(), 'consultant_basic', 'ai_assistant', 0),
  (UUID(), 'consultant_pro', 'ai_assistant', 1),
  (UUID(), 'consultant', 'ai_assistant', 1),
  (UUID(), 'sme', 'ai_assistant', 1),
  (UUID(), 'enterprise', 'ai_assistant', 1);
