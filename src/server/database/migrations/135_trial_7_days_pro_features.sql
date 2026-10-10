-- The free trial (user 2026-10-10): 7 days instead of 14, every Pro feature on, and 50K AI tokens
-- a month instead of 5K (about 10 questions; about 50 cents of AI per person per calendar month,
-- counted like every plan's AI budget). Sign-up reads duration_days for the trial's length. Limits on projects (3) and storage
-- (100MB) stay. People already on a trial keep the end date they have. Viewers: every company is
-- created with 5 (OrganizationService), so the trial already allows 5; the plan row said 0.

UPDATE pricing_config
   SET duration_days = 7,
       viewer_limit = 5,
       viewer_limit_label = '5',
       ai_tokens_monthly = 50000,
       ai_tokens_label = '50K',
       ai_tokens_description = '~10 AI questions to explore Mjuzi',
       features_json = '["Up to 3 projects","7-day full access (Pro features)","Mjuzi AI assistant (50K tokens)","Gantt, Kanban, Sprint boards","RAID management","No credit card required"]'
 WHERE tier = 'trial';

-- Every feature Pro has, the trial has (a feature added to Pro later is decided then)
INSERT INTO tier_features (id, tier, feature_key, enabled)
SELECT UUID(), 'trial', feature_key, 1
  FROM tier_features
 WHERE tier = 'consultant_pro' AND enabled = 1
ON DUPLICATE KEY UPDATE tier_features.enabled = 1;
