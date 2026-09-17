-- Schedule Review Phase 3: structural fix proposals.
-- Self-contained proposal store (JSON blob) mirroring the reschedule_proposals
-- pattern. Tenant table — apply to every tenant DB. No ENUM (extensible via JSON).
CREATE TABLE IF NOT EXISTS schedule_fix_proposals (
  id VARCHAR(36) PRIMARY KEY,
  schedule_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',   -- pending | applied | rejected | undone
  source VARCHAR(20) NOT NULL DEFAULT 'ai',         -- ai | rules
  review_id VARCHAR(36) NULL,
  proposal_data JSON NOT NULL,                      -- { fixes:[...], summary }
  applied_data JSON NULL,                           -- reversal log recorded at apply time
  baseline_id VARCHAR(36) NULL,                     -- "Pre-review baseline" for date safety
  rules_version VARCHAR(10) NOT NULL,
  created_by VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMP NULL,
  INDEX idx_sfp_schedule (schedule_id, created_at)
);
