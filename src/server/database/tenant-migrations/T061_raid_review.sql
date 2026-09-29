-- RAID Review (2026-09-29): a rule-based quality check of a project's RAID log, with
-- proposed fixes the PM ticks and applies, and one-step undo.
--
-- project_risks gains two real fields the register import used to keep only as notes:
--   response_strategy  avoid | mitigate | transfer | accept | escalate (PMI risk responses)
--   closure_reason     why the item was closed
ALTER TABLE project_risks
  ADD COLUMN IF NOT EXISTS response_strategy VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS closure_reason TEXT NULL;

-- One row per review run; findings as JSON (the latest row is what the panel shows).
CREATE TABLE IF NOT EXISTS raid_reviews (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  score INT NOT NULL,
  rules_version VARCHAR(10) NOT NULL,
  items_checked INT NOT NULL DEFAULT 0,
  findings JSON NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_raid_reviews_project (project_id, created_at)
);

-- Checks a project has switched off.
CREATE TABLE IF NOT EXISTS raid_review_settings (
  project_id CHAR(36) NOT NULL PRIMARY KEY,
  disabled_rules JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Applied fixes, with each item's previous values so the batch can be undone.
CREATE TABLE IF NOT EXISTS raid_fix_batches (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  previous JSON NULL,
  item_ids JSON NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at TIMESTAMP NULL,
  undone_by CHAR(36) NULL,
  INDEX idx_raid_fix_batches_project (project_id, created_at)
);
