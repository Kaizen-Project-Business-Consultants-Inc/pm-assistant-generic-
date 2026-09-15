-- Migration 110: Enable resources, reports, workflows for consultant_basic tier
-- These are core PM features that should be available in the Basic tier.
-- AI-powered features remain Pro-only.

UPDATE tier_features SET enabled = 1
WHERE tier = 'consultant_basic'
  AND feature_key IN ('resources', 'reports', 'workflows');

-- Update pricing_config features JSON for consultant_basic
UPDATE pricing_config
SET features_json = '["Unlimited projects","Gantt, Kanban, Sprint boards","RAID management","Resource management & heatmaps","Custom report builder","Workflow automation","All exports (CSV, PDF, XML)","API access & integrations","5 free viewer invites","Stakeholder portal"]'
WHERE tier = 'consultant_basic';
